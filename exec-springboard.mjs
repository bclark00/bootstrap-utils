#!/usr/bin/env node
/**
 * exec-springboard.mjs v2 -- Elevated (root) exec worker for Claude exec-bridge
 *
 * Runs as root via systemd. Companion to exec-bridge.mjs.
 * Watches ~/.exec-bridge/elevated/ for request files, executes as root.
 *
 * Security model:
 *   - Request dir is /home/zorin/.exec-bridge/elevated/ (mode 770, owned zorin)
 *   - Only root and zorin can write requests
 *   - Optional SPRINGBOARD_ALLOWLIST (comma-separated command prefixes)
 *   - Requests time out after EXEC_TIMEOUT_MS (max 300s)
 *   - Each request processed exactly once (req file deleted before exec)
 *
 * Protocol (identical to exec-bridge):
 *   req-{id}.json  ->  { id, cmd, cwd?, env?, timeout_ms? }
 *   res-{id}.json  <-  { id, stdout, stderr, exit_code, duration_ms, error?, ts }
 *
 * Environment variables:
 *   BRIDGE_DIR              default: /home/zorin/.exec-bridge
 *   POLL_INTERVAL           ms, default: 200
 *   EXEC_TIMEOUT_MS         default: 60000 (max 300000)
 *   MAX_OUTPUT              default: 4MB
 *   MAX_CONCURRENT          default: 5
 *   CLEANUP_AGE_MS          default: 1800000 (30 min)
 *   CLEANUP_INTERVAL        default: 300000 (5 min)
 *   SPRINGBOARD_ALLOWLIST   comma-separated prefixes; empty = allow all
 *
 * (c) 2025-2026 Brandon Clark. All Rights Reserved.
 */

import fs       from 'fs';
import path     from 'path';
import os       from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Config ───────────────────────────────────────────────────────────────────

const ZORIN_HOME        = '/home/zorin';
const BRIDGE_DIR        = process.env.BRIDGE_DIR        || path.join(ZORIN_HOME, '.exec-bridge');
const ELEVATED_DIR      = path.join(BRIDGE_DIR, 'elevated');
const POLL_INTERVAL     = parseInt(process.env.POLL_INTERVAL     || '200');
const EXEC_TIMEOUT_MS   = parseInt(process.env.EXEC_TIMEOUT_MS   || '60000');
const MAX_OUTPUT        = parseInt(process.env.MAX_OUTPUT        || String(4 * 1024 * 1024));
const MAX_CONCURRENT    = parseInt(process.env.MAX_CONCURRENT    || '5');
const CLEANUP_AGE_MS    = parseInt(process.env.CLEANUP_AGE_MS    || String(30 * 60 * 1000));
const CLEANUP_INTERVAL  = parseInt(process.env.CLEANUP_INTERVAL  || String(5  * 60 * 1000));
const ALLOWLIST_RAW     = process.env.SPRINGBOARD_ALLOWLIST || '';
const allowlist         = ALLOWLIST_RAW
  ? ALLOWLIST_RAW.split(',').map(s => s.trim()).filter(Boolean)
  : null;

// NVM node bin -- detect from zorin's home, fall back to system node
function detectNvmNodeBin() {
  try {
    const nvmVersions = path.join(ZORIN_HOME, '.nvm', 'versions', 'node');
    const versions    = fs.readdirSync(nvmVersions).filter(v => v.startsWith('v')).sort();
    if (versions.length > 0) {
      return path.join(nvmVersions, versions[versions.length - 1], 'bin');
    }
  } catch (_) {}
  return '';
}

const NVM_NODE_BIN = detectNvmNodeBin();

const AUGMENTED_PATH = [
  NVM_NODE_BIN,
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
  '/snap/bin',
  path.join(ZORIN_HOME, '.local', 'bin'),
].filter(Boolean).join(':');

// ─── Logging ──────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago', hour12: true,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
const log  = (...a) => console.log(`[${ts()}] [SPRINGBOARD]`, ...a);
const warn = (...a) => console.warn(`[${ts()}] [SPRINGBOARD] WARN`, ...a);

// ─── Concurrency control ─────────────────────────────────────────────────────

const _inflight = new Set();
const _queue    = [];

function tryDequeue() {
  while (_inflight.size < MAX_CONCURRENT && _queue.length > 0) {
    const reqFile = _queue.shift();
    processRequest(reqFile);
  }
}

// ─── Request processor ───────────────────────────────────────────────────────

async function processRequest(reqFile) {
  if (_inflight.has(reqFile)) return;

  if (_inflight.size >= MAX_CONCURRENT) {
    if (!_queue.includes(reqFile)) _queue.push(reqFile);
    return;
  }

  _inflight.add(reqFile);

  const reqPath = path.join(ELEVATED_DIR, reqFile);
  const id      = reqFile.replace(/^req-/, '').replace(/\.json$/, '');
  const resPath = path.join(ELEVATED_DIR, `res-${id}.json`);

  let req;
  try {
    req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
  } catch (e) {
    warn(`Failed to read ${reqFile}: ${e.message}`);
    _inflight.delete(reqFile);
    tryDequeue();
    return;
  }

  if (!req.cmd || typeof req.cmd !== 'string') {
    writeResult(resPath, id, '', 'Invalid request: cmd required', 1, 0, 'invalid');
    tryUnlink(reqPath);
    _inflight.delete(reqFile);
    tryDequeue();
    return;
  }

  // Allowlist check
  if (allowlist) {
    const allowed = allowlist.some(prefix => req.cmd.startsWith(prefix));
    if (!allowed) {
      warn(`Blocked: ${req.cmd.slice(0, 80)}`);
      writeResult(resPath, id, '', `Command not in allowlist: ${req.cmd.slice(0, 60)}`, 1, 0, 'blocked');
      tryUnlink(reqPath);
      _inflight.delete(reqFile);
      tryDequeue();
      return;
    }
  }

  const cwd     = req.cwd || ZORIN_HOME;
  const timeout = Math.min(req.timeout_ms || EXEC_TIMEOUT_MS, 300_000);
  const t0      = Date.now();

  log(`exec [${id.slice(0, 8)}] ${req.cmd.slice(0, 100)}`);

  // Delete req immediately -- prevent reprocessing on restart
  tryUnlink(reqPath);

  try {
    const { stdout, stderr } = await execAsync(req.cmd, {
      cwd,
      timeout,
      maxBuffer: MAX_OUTPUT,
      env: {
        PATH: AUGMENTED_PATH,
        HOME: ZORIN_HOME,
        USER: 'root',
        DEBIAN_FRONTEND: 'noninteractive',
        ...(req.env || {}),
      },
      shell: '/bin/bash',
    });
    const duration_ms = Date.now() - t0;
    writeResult(resPath, id, stdout, stderr, 0, duration_ms, null);
    log(`done [${id.slice(0, 8)}] exit=0 ${duration_ms}ms`);
  } catch (e) {
    const duration_ms = Date.now() - t0;
    writeResult(resPath, id,
      e.stdout || '', e.stderr || e.message,
      e.code ?? 1, duration_ms,
      e.killed ? 'timeout' : e.message);
    log(`done [${id.slice(0, 8)}] exit=${e.code ?? 1} ${duration_ms}ms`);
  }

  // Ensure res file is readable by zorin
  try { fs.chownSync(resPath, 1000, 1000); } catch (_) {}

  _inflight.delete(reqFile);
  tryDequeue();
}

function writeResult(resPath, id, stdout, stderr, exit_code, duration_ms, error) {
  const res = { id, stdout, stderr, exit_code, duration_ms, ts: new Date().toISOString() };
  if (error) res.error = error;
  fs.writeFileSync(resPath, JSON.stringify(res, null, 2));
  try { fs.chownSync(resPath, 1000, 1000); } catch (_) {}
}

function tryUnlink(p) {
  try { fs.unlinkSync(p); } catch (_) {}
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

function poll() {
  let files;
  try { files = fs.readdirSync(ELEVATED_DIR); }
  catch (_) { return; }

  for (const f of files) {
    if (f.startsWith('req-') && f.endsWith('.json')) {
      processRequest(f);
    }
  }
}

// ─── Stale file cleanup ───────────────────────────────────────────────────────

function cleanupStale() {
  let files;
  try { files = fs.readdirSync(ELEVATED_DIR); }
  catch (_) { return; }

  const cutoff = Date.now() - CLEANUP_AGE_MS;
  let removed = 0;
  for (const f of files) {
    if (!f.startsWith('res-') || !f.endsWith('.json')) continue;
    const fp = path.join(ELEVATED_DIR, f);
    try {
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fp);
        removed++;
      }
    } catch (_) {}
  }
  if (removed > 0) log(`cleanup: removed ${removed} stale res file(s)`);
}

// ─── Startup canary ───────────────────────────────────────────────────────────

async function runCanary() {
  const id      = `canary-${Date.now()}`;
  const reqPath = path.join(ELEVATED_DIR, `req-${id}.json`);
  const resPath = path.join(ELEVATED_DIR, `res-${id}.json`);

  fs.writeFileSync(reqPath, JSON.stringify({ id, cmd: 'echo exec-springboard-ok && id' }));
  try { fs.chownSync(reqPath, 0, 0); } catch (_) {}

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (fs.existsSync(resPath)) {
      const res = JSON.parse(fs.readFileSync(resPath, 'utf8'));
      tryUnlink(resPath);
      if (res.exit_code === 0 && res.stdout.includes('exec-springboard-ok')) {
        log(`canary: PASS (${res.stdout.split('\n').join(' | ').trim()})`);
        return true;
      }
      log(`canary: FAIL (exit=${res.exit_code})`);
      return false;
    }
  }
  log('canary: TIMEOUT');
  tryUnlink(reqPath);
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Create dirs, set permissions
  fs.mkdirSync(ELEVATED_DIR, { recursive: true });
  try { fs.chmodSync(ELEVATED_DIR, 0o770); } catch (_) {}
  try { fs.chownSync(ELEVATED_DIR, 1000, 1000); } catch (_) {}

  log(`starting v2 (PID ${process.pid}, euid=${process.getuid?.() ?? '?'})`);
  log(`elevated dir : ${ELEVATED_DIR}`);
  log(`nvm node bin : ${NVM_NODE_BIN || '(not found, using system node)'}`);
  log(`poll interval: ${POLL_INTERVAL}ms  timeout: ${EXEC_TIMEOUT_MS}ms  max_concurrent: ${MAX_CONCURRENT}`);
  log(`allowlist    : ${allowlist ? allowlist.join(', ') : 'NONE (all commands allowed)'}`);

  // Clean stale files from previous sessions
  cleanupStale();

  setInterval(poll, POLL_INTERVAL);
  poll();

  setInterval(cleanupStale, CLEANUP_INTERVAL);

  log('ready -- polling for elevated requests');

  setTimeout(() => runCanary(), 600);

  process.on('SIGINT',  () => { log('SIGINT'); process.exit(0); });
  process.on('SIGTERM', () => { log('SIGTERM'); process.exit(0); });
}

main();
