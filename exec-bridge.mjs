#!/usr/bin/env node
/**
 * exec-bridge.mjs v3 -- Unified exec IPC daemon for Claude container <-> host
 *
 * Runs as root via systemd. Handles both standard and elevated requests.
 * Standard requests are privilege-dropped to ZORIN_UID before exec.
 * Elevated requests run as root.
 *
 * Protocol:
 *   Standard:  ~/.exec-bridge/req-{id}.json   -> res-{id}.json
 *   Elevated:  ~/.exec-bridge/elevated/req-{id}.json -> elevated/res-{id}.json
 *
 *   Request:  { id, cmd, cwd?, env?, timeout_ms? }
 *   Response: { id, stdout, stderr, exit_code, duration_ms, ts, error? }
 *
 * Environment variables:
 *   BRIDGE_DIR         default: /home/zorin/.exec-bridge
 *   POLL_INTERVAL      ms, default: 200
 *   EXEC_TIMEOUT_MS    standard timeout, default: 30000 (max 120000)
 *   ELEV_TIMEOUT_MS    elevated timeout, default: 60000 (max 300000)
 *   MAX_OUTPUT         max stdout+stderr bytes, default: 2MB (elevated: 4MB)
 *   MAX_CONCURRENT     max parallel commands across both queues, default: 15
 *   CLEANUP_AGE_MS     delete res files older than this, default: 1800000 (30m)
 *   CLEANUP_INTERVAL   how often to scan for stale files, default: 300000 (5m)
 *   ZORIN_UID          uid to drop to for standard requests, default: 1000
 *   ZORIN_GID          gid to drop to for standard requests, default: 1000
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

const ZORIN_HOME      = '/home/zorin';
const ZORIN_UID       = parseInt(process.env.ZORIN_UID       || '1000');
const ZORIN_GID       = parseInt(process.env.ZORIN_GID       || '1000');
const BRIDGE_DIR      = process.env.BRIDGE_DIR      || path.join(ZORIN_HOME, '.exec-bridge');
const ELEVATED_DIR    = path.join(BRIDGE_DIR, 'elevated');
const POLL_INTERVAL   = parseInt(process.env.POLL_INTERVAL   || '200');
const EXEC_TIMEOUT_MS = parseInt(process.env.EXEC_TIMEOUT_MS || '30000');
const ELEV_TIMEOUT_MS = parseInt(process.env.ELEV_TIMEOUT_MS || '60000');
const MAX_OUTPUT      = parseInt(process.env.MAX_OUTPUT      || String(2 * 1024 * 1024));
const MAX_ELEV_OUTPUT = MAX_OUTPUT * 2;
const MAX_CONCURRENT  = parseInt(process.env.MAX_CONCURRENT  || '15');
const CLEANUP_AGE_MS  = parseInt(process.env.CLEANUP_AGE_MS  || String(30 * 60 * 1000));
const CLEANUP_INTERVAL= parseInt(process.env.CLEANUP_INTERVAL|| String(5  * 60 * 1000));

// Detect latest NVM node bin for PATH augmentation
function detectNvmNodeBin() {
  try {
    const base = path.join(ZORIN_HOME, '.nvm', 'versions', 'node');
    const vers = fs.readdirSync(base).filter(v => v.startsWith('v')).sort();
    if (vers.length) return path.join(base, vers[vers.length - 1], 'bin');
  } catch (_) {}
  return '';
}

const NVM_NODE_BIN = detectNvmNodeBin();

const BASE_PATH = [
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
const log  = (...a) => console.log(`[${ts()}] [EXEC-BRIDGE]`, ...a);
const warn = (...a) => console.warn(`[${ts()}] [EXEC-BRIDGE] WARN`, ...a);

// ─── Concurrency control ─────────────────────────────────────────────────────

const _inflight = new Set();
const _queue    = [];   // { reqFile, dir, elevated }

function tryDequeue() {
  while (_inflight.size < MAX_CONCURRENT && _queue.length > 0) {
    const item = _queue.shift();
    processRequest(item.reqFile, item.dir, item.elevated);
  }
}

// ─── Request processor ───────────────────────────────────────────────────────

async function processRequest(reqFile, dir, elevated) {
  const key = `${elevated ? 'e' : 's'}:${reqFile}`;
  if (_inflight.has(key)) return;

  if (_inflight.size >= MAX_CONCURRENT) {
    if (!_queue.find(q => q.reqFile === reqFile && q.elevated === elevated))
      _queue.push({ reqFile, dir, elevated });
    return;
  }

  _inflight.add(key);

  const reqPath = path.join(dir, reqFile);
  const id      = reqFile.replace(/^req-/, '').replace(/\.json$/, '');
  const resPath = path.join(dir, `res-${id}.json`);

  let req;
  try {
    req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
  } catch (e) {
    warn(`Failed to read ${reqFile}: ${e.message}`);
    _inflight.delete(key);
    tryDequeue();
    return;
  }

  if (!req.cmd || typeof req.cmd !== 'string') {
    writeResult(resPath, id, '', 'Invalid request: cmd required', 1, 0, 'invalid', elevated);
    tryUnlink(reqPath);
    _inflight.delete(key);
    tryDequeue();
    return;
  }

  const maxTimeout = elevated ? 300_000 : 120_000;
  const defTimeout = elevated ? ELEV_TIMEOUT_MS : EXEC_TIMEOUT_MS;
  const cwd        = req.cwd || ZORIN_HOME;
  const timeout    = Math.min(req.timeout_ms || defTimeout, maxTimeout);
  const maxBuf     = elevated ? MAX_ELEV_OUTPUT : MAX_OUTPUT;
  const t0         = Date.now();
  const label      = elevated ? 'elevated' : 'standard';

  log(`exec [${id.slice(0, 8)}] (${label}) ${req.cmd.slice(0, 100)}`);

  // Delete req immediately -- prevents reprocessing on restart
  tryUnlink(reqPath);

  // Build env: elevated keeps root context, standard drops to zorin
  const baseEnv = {
    PATH: BASE_PATH,
    DEBIAN_FRONTEND: 'noninteractive',
    ...(req.env || {}),
  };

  const execEnv = elevated
    ? { ...baseEnv, HOME: ZORIN_HOME, USER: 'root' }
    : { ...baseEnv, HOME: ZORIN_HOME, USER: 'zorin' };

  // Exec options: standard requests drop privileges to ZORIN_UID/GID
  const execOpts = {
    cwd, timeout, maxBuffer: maxBuf,
    env: execEnv,
    shell: '/bin/bash',
    ...(elevated ? {} : { uid: ZORIN_UID, gid: ZORIN_GID }),
  };

  try {
    const { stdout, stderr } = await execAsync(req.cmd, execOpts);
    const duration_ms = Date.now() - t0;
    writeResult(resPath, id, stdout, stderr, 0, duration_ms, null, elevated);
    log(`done [${id.slice(0, 8)}] exit=0 ${duration_ms}ms`);
  } catch (e) {
    const duration_ms = Date.now() - t0;
    writeResult(resPath, id,
      e.stdout || '', e.stderr || e.message,
      e.code ?? 1, duration_ms,
      e.killed ? 'timeout' : e.message,
      elevated);
    log(`done [${id.slice(0, 8)}] exit=${e.code ?? 1} ${duration_ms}ms`);
  }

  _inflight.delete(key);
  tryDequeue();
}

function writeResult(resPath, id, stdout, stderr, exit_code, duration_ms, error, elevated) {
  const res = { id, stdout, stderr, exit_code, duration_ms, ts: new Date().toISOString() };
  if (error) res.error = error;
  fs.writeFileSync(resPath, JSON.stringify(res, null, 2));
  // Ensure zorin can read elevated responses
  if (elevated) {
    try { fs.chownSync(resPath, ZORIN_UID, ZORIN_GID); } catch (_) {}
  }
}

function tryUnlink(p) {
  try { fs.unlinkSync(p); } catch (_) {}
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

function poll() {
  // Standard queue
  let files;
  try { files = fs.readdirSync(BRIDGE_DIR); } catch (_) { files = []; }
  for (const f of files) {
    if (f.startsWith('req-') && f.endsWith('.json'))
      processRequest(f, BRIDGE_DIR, false);
  }

  // Elevated queue
  let efiles;
  try { efiles = fs.readdirSync(ELEVATED_DIR); } catch (_) { efiles = []; }
  for (const f of efiles) {
    if (f.startsWith('req-') && f.endsWith('.json'))
      processRequest(f, ELEVATED_DIR, true);
  }
}

// ─── Stale file cleanup ───────────────────────────────────────────────────────

function cleanupDir(dir, label) {
  let files;
  try { files = fs.readdirSync(dir); } catch (_) { return 0; }
  const cutoff = Date.now() - CLEANUP_AGE_MS;
  let removed = 0;
  for (const f of files) {
    if (!f.startsWith('res-') || !f.endsWith('.json')) continue;
    const fp = path.join(dir, f);
    try {
      if (fs.statSync(fp).mtimeMs < cutoff) { fs.unlinkSync(fp); removed++; }
    } catch (_) {}
  }
  if (removed > 0) log(`cleanup [${label}]: removed ${removed} stale file(s)`);
  return removed;
}

function cleanupAll() {
  cleanupDir(BRIDGE_DIR, 'standard');
  cleanupDir(ELEVATED_DIR, 'elevated');
}

// ─── Startup canary ───────────────────────────────────────────────────────────

async function runCanary(dir, cmd, label) {
  const id      = `canary-${Date.now()}`;
  const reqPath = path.join(dir, `req-${id}.json`);
  const resPath = path.join(dir, `res-${id}.json`);

  fs.writeFileSync(reqPath, JSON.stringify({ id, cmd }));

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (fs.existsSync(resPath)) {
      const res = JSON.parse(fs.readFileSync(resPath, 'utf8'));
      tryUnlink(resPath);
      if (res.exit_code === 0) {
        log(`canary [${label}]: PASS -- ${res.stdout.trim().replace(/\n/g, ' | ')}`);
        return true;
      }
      log(`canary [${label}]: FAIL -- exit=${res.exit_code} ${res.stderr?.trim()}`);
      return false;
    }
  }
  log(`canary [${label}]: TIMEOUT`);
  tryUnlink(reqPath);
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Must run as root
  if (process.getuid?.() !== 0) {
    console.error('exec-bridge v3 must run as root (for privilege-drop to work)');
    process.exit(1);
  }

  // Create dirs with correct permissions
  fs.mkdirSync(BRIDGE_DIR,   { recursive: true, mode: 0o770 });
  fs.mkdirSync(ELEVATED_DIR, { recursive: true, mode: 0o770 });
  try { fs.chownSync(BRIDGE_DIR,   ZORIN_UID, ZORIN_GID); } catch (_) {}
  try { fs.chownSync(ELEVATED_DIR, ZORIN_UID, ZORIN_GID); } catch (_) {}

  log(`starting v3 (PID ${process.pid}, uid=0)`);
  log(`bridge dir   : ${BRIDGE_DIR}`);
  log(`elevated dir : ${ELEVATED_DIR}`);
  log(`nvm node bin : ${NVM_NODE_BIN || '(not found)'}`);
  log(`poll interval: ${POLL_INTERVAL}ms`);
  log(`timeouts     : standard=${EXEC_TIMEOUT_MS}ms  elevated=${ELEV_TIMEOUT_MS}ms`);
  log(`max_concurrent: ${MAX_CONCURRENT}  cleanup_age: ${CLEANUP_AGE_MS / 60000}min`);

  // Startup cleanup
  cleanupAll();

  // Poll loop + periodic cleanup
  setInterval(poll, POLL_INTERVAL);
  setInterval(cleanupAll, CLEANUP_INTERVAL);
  poll();

  log('ready -- polling standard + elevated queues');

  // Dual canary after stabilization
  setTimeout(async () => {
    await runCanary(BRIDGE_DIR,   'echo standard-ok && id', 'standard');
    await runCanary(ELEVATED_DIR, 'echo elevated-ok && id', 'elevated');
  }, 500);

  process.on('SIGINT',  () => { log('SIGINT');  process.exit(0); });
  process.on('SIGTERM', () => { log('SIGTERM'); process.exit(0); });
}

main();
