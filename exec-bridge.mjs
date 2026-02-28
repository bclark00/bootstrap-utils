#!/usr/bin/env node
/**
 * exec-bridge.mjs v2 -- File-based exec IPC between Claude container and host
 *
 * Runs as zorin (unprivileged). For root commands use exec-springboard.mjs.
 *
 * Protocol:
 *   Container writes:  ~/.exec-bridge/req-{id}.json
 *     { id, cmd, cwd?, env?, timeout_ms? }
 *
 *   Host executes and writes: ~/.exec-bridge/res-{id}.json
 *     { id, stdout, stderr, exit_code, duration_ms, error? }
 *
 *   Container reads response then deletes res file.
 *   Host deletes req file immediately after picking it up.
 *
 * Environment variables:
 *   BRIDGE_DIR         default: ~/.exec-bridge
 *   POLL_INTERVAL      ms between polls, default: 200
 *   EXEC_TIMEOUT_MS    per-command timeout, default: 30000 (max 120000)
 *   MAX_OUTPUT         max stdout+stderr bytes, default: 2MB
 *   MAX_CONCURRENT     max parallel commands, default: 10
 *   CLEANUP_AGE_MS     delete res files older than this, default: 1800000 (30 min)
 *   CLEANUP_INTERVAL   how often to scan for stale files, default: 300000 (5 min)
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

const BRIDGE_DIR        = process.env.BRIDGE_DIR        || path.join(os.homedir(), '.exec-bridge');
const POLL_INTERVAL     = parseInt(process.env.POLL_INTERVAL     || '200');
const EXEC_TIMEOUT_MS   = parseInt(process.env.EXEC_TIMEOUT_MS   || '30000');
const MAX_OUTPUT        = parseInt(process.env.MAX_OUTPUT        || String(2 * 1024 * 1024));
const MAX_CONCURRENT    = parseInt(process.env.MAX_CONCURRENT    || '10');
const CLEANUP_AGE_MS    = parseInt(process.env.CLEANUP_AGE_MS    || String(30 * 60 * 1000));
const CLEANUP_INTERVAL  = parseInt(process.env.CLEANUP_INTERVAL  || String(5  * 60 * 1000));

// PATH augmented to include NVM node and common tool locations -- systemd
// provides only a minimal PATH that omits these.
const NVM_NODE_BIN = path.join(os.homedir(), '.nvm', 'versions', 'node',
  fs.readdirSync(path.join(os.homedir(), '.nvm', 'versions', 'node'))
    .filter(v => v.startsWith('v'))
    .sort()
    .pop() || 'v24.0.0',
  'bin');

const AUGMENTED_PATH = [
  NVM_NODE_BIN,
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
  '/snap/bin',
  path.join(os.homedir(), '.local', 'bin'),
].join(':');

// ─── Logging ──────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago', hour12: true,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
const log  = (...a) => console.log(`[${ts()}] [EXEC-BRIDGE]`, ...a);
const warn = (...a) => console.warn(`[${ts()}] [EXEC-BRIDGE] WARN`, ...a);

// ─── Concurrency control ─────────────────────────────────────────────────────

const _inflight = new Set();   // currently executing request IDs
const _queue    = [];          // pending req filenames when at capacity

function tryDequeue() {
  while (_inflight.size < MAX_CONCURRENT && _queue.length > 0) {
    const reqFile = _queue.shift();
    processRequest(reqFile);
  }
}

// ─── Request processor ───────────────────────────────────────────────────────

async function processRequest(reqFile) {
  if (_inflight.has(reqFile)) return;

  // Respect concurrency cap
  if (_inflight.size >= MAX_CONCURRENT) {
    if (!_queue.includes(reqFile)) _queue.push(reqFile);
    return;
  }

  _inflight.add(reqFile);

  const reqPath = path.join(BRIDGE_DIR, reqFile);
  const id      = reqFile.replace(/^req-/, '').replace(/\.json$/, '');
  const resPath = path.join(BRIDGE_DIR, `res-${id}.json`);

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

  const cwd     = req.cwd || os.homedir();
  const timeout = Math.min(req.timeout_ms || EXEC_TIMEOUT_MS, 120_000);
  const t0      = Date.now();

  log(`exec [${id.slice(0, 8)}] ${req.cmd.slice(0, 100)}`);

  // Delete req immediately so we don't reprocess on crash/restart
  tryUnlink(reqPath);

  try {
    const { stdout, stderr } = await execAsync(req.cmd, {
      cwd,
      timeout,
      maxBuffer: MAX_OUTPUT,
      env: {
        ...process.env,
        PATH: AUGMENTED_PATH,
        HOME: os.homedir(),
        USER: os.userInfo().username,
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

  _inflight.delete(reqFile);
  tryDequeue();
}

function writeResult(resPath, id, stdout, stderr, exit_code, duration_ms, error) {
  const res = { id, stdout, stderr, exit_code, duration_ms, ts: new Date().toISOString() };
  if (error) res.error = error;
  fs.writeFileSync(resPath, JSON.stringify(res, null, 2));
}

function tryUnlink(p) {
  try { fs.unlinkSync(p); } catch (_) {}
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

function poll() {
  let files;
  try {
    files = fs.readdirSync(BRIDGE_DIR);
  } catch (_) { return; }

  for (const f of files) {
    if (f.startsWith('req-') && f.endsWith('.json')) {
      processRequest(f);
    }
  }
}

// ─── Stale file cleanup ───────────────────────────────────────────────────────

function cleanupStale() {
  let files;
  try { files = fs.readdirSync(BRIDGE_DIR); }
  catch (_) { return; }

  const cutoff = Date.now() - CLEANUP_AGE_MS;
  let removed = 0;
  for (const f of files) {
    // Only clean up res files, never req files (those are active requests)
    if (!f.startsWith('res-') || !f.endsWith('.json')) continue;
    const fp = path.join(BRIDGE_DIR, f);
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
  const reqPath = path.join(BRIDGE_DIR, `req-${id}.json`);
  const resPath = path.join(BRIDGE_DIR, `res-${id}.json`);

  fs.writeFileSync(reqPath, JSON.stringify({ id, cmd: 'echo exec-bridge-ok' }));

  // Wait up to 3 seconds
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (fs.existsSync(resPath)) {
      const res = JSON.parse(fs.readFileSync(resPath, 'utf8'));
      tryUnlink(resPath);
      if (res.exit_code === 0 && res.stdout.includes('exec-bridge-ok')) {
        log('canary: PASS');
        return true;
      }
      log(`canary: FAIL (exit=${res.exit_code} stdout=${res.stdout.trim()})`);
      return false;
    }
  }
  log('canary: TIMEOUT');
  tryUnlink(reqPath);
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(BRIDGE_DIR, { recursive: true, mode: 0o700 });

  log(`starting v2 (PID ${process.pid})`);
  log(`bridge dir  : ${BRIDGE_DIR}`);
  log(`nvm node bin: ${NVM_NODE_BIN}`);
  log(`poll interval: ${POLL_INTERVAL}ms  timeout: ${EXEC_TIMEOUT_MS}ms  max_concurrent: ${MAX_CONCURRENT}`);
  log(`cleanup: every ${CLEANUP_INTERVAL / 1000}s, age > ${CLEANUP_AGE_MS / 60000}min`);

  // Clean up any stale files from previous sessions on startup
  cleanupStale();

  // Begin polling
  setInterval(poll, POLL_INTERVAL);
  poll();

  // Periodic stale file cleanup
  setInterval(cleanupStale, CLEANUP_INTERVAL);

  log('ready -- polling for requests');

  // Self-test after a short delay (let poll loop stabilize)
  setTimeout(() => runCanary(), 500);

  process.on('SIGINT',  () => { log('SIGINT'); process.exit(0); });
  process.on('SIGTERM', () => { log('SIGTERM'); process.exit(0); });
}

main();
