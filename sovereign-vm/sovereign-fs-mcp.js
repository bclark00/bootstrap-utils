#!/usr/bin/env node
/**
 * SOVEREIGN-FS-MCP v1.0.0
 *
 * Capability:  ipc_rpc, fs_read, fs_write
 * Deps:        ZERO (Node.js built-ins only)
 * Credentials: ZERO (no tokens, no keys, no secrets)
 * Auth:        Path allowlist — rootDir only, no escape
 * Integrity:   Every file read returns SHA256 alongside content
 * Identity:    Content-addressed — this file's own hash is its ID
 *
 * Replaces:    windows-file-mcp-server.js (infected substrate)
 * Clean delta: No ipc_rpc to arbitrary external processes
 *              No path traversal outside rootDir
 *              No credentials in env or config
 *
 * Tools:
 *   fs_read        path -> { content, sha256, size }
 *   fs_write       path, content -> { sha256, size }
 *   fs_list        dir -> [{ name, type, size, sha256? }]
 *   fs_exists      path -> { exists, type }
 *   fs_delete      path -> { deleted }
 *   fs_mkdir       path -> { created }
 *   fs_manifest    dir -> { files: [{path, sha256, size}] }  ← content-addressed index
 *   fs_self        -> { version, sha256, capabilities }      ← self-describing
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const readline = require('readline');

// ── Configuration ─────────────────────────────────────────────────────────────
// rootDir: only path we'll touch. Default to CWD, override via SOVEREIGN_FS_ROOT env.
// No credentials. No external connections. No process spawning.

const ROOT_DIR = process.env.SOVEREIGN_FS_ROOT
  ? path.resolve(process.env.SOVEREIGN_FS_ROOT)
  : path.resolve(process.cwd());

const READ_ONLY = process.env.SOVEREIGN_FS_READONLY === '1';
const MAX_FILE_BYTES = parseInt(process.env.SOVEREIGN_FS_MAX_BYTES || '10485760'); // 10MB default

// ── Integrity ─────────────────────────────────────────────────────────────────

function sha256File(filepath) {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256Str(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

// ── Path safety ───────────────────────────────────────────────────────────────

function safePath(rawPath) {
  const resolved = path.resolve(ROOT_DIR, rawPath);
  if (!resolved.startsWith(ROOT_DIR + path.sep) && resolved !== ROOT_DIR) {
    throw new Error('PATH_ESCAPE: ' + rawPath + ' escapes root ' + ROOT_DIR);
  }
  return resolved;
}

// ── Tool implementations ──────────────────────────────────────────────────────

function tool_fs_read({ path: p }) {
  const fp = safePath(p);
  const stat = fs.statSync(fp);
  if (!stat.isFile()) throw new Error('NOT_FILE: ' + p);
  if (stat.size > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE: ' + stat.size + ' > ' + MAX_FILE_BYTES);
  const buf = fs.readFileSync(fp);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return {
    content: buf.toString('utf8'),
    sha256,
    size: stat.size,
    path: p,
  };
}

function tool_fs_write({ path: p, content }) {
  if (READ_ONLY) throw new Error('READ_ONLY_MODE');
  const fp = safePath(p);
  // Ensure parent exists
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const buf = Buffer.from(content, 'utf8');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(fp, buf);
  return { sha256, size: buf.length, path: p };
}

function tool_fs_list({ path: p = '.' }) {
  const fp = safePath(p);
  const entries = fs.readdirSync(fp, { withFileTypes: true });
  return entries.map(e => {
    const entryPath = path.join(fp, e.name);
    const result = {
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
    };
    if (e.isFile()) {
      try {
        const stat = fs.statSync(entryPath);
        result.size = stat.size;
        if (stat.size < 1048576) { // hash files < 1MB only
          result.sha256 = sha256File(entryPath);
        }
      } catch (_) {}
    }
    return result;
  });
}

function tool_fs_exists({ path: p }) {
  try {
    const fp = safePath(p);
    const stat = fs.statSync(fp);
    return { exists: true, type: stat.isDirectory() ? 'dir' : 'file', size: stat.size };
  } catch (_) {
    return { exists: false };
  }
}

function tool_fs_delete({ path: p }) {
  if (READ_ONLY) throw new Error('READ_ONLY_MODE');
  const fp = safePath(p);
  const stat = fs.statSync(fp);
  if (stat.isDirectory()) {
    fs.rmdirSync(fp, { recursive: true });
  } else {
    fs.unlinkSync(fp);
  }
  return { deleted: true, path: p };
}

function tool_fs_mkdir({ path: p }) {
  if (READ_ONLY) throw new Error('READ_ONLY_MODE');
  const fp = safePath(p);
  fs.mkdirSync(fp, { recursive: true });
  return { created: true, path: p };
}

function tool_fs_manifest({ path: p = '.' }) {
  const fp = safePath(p);
  const files = [];

  function walk(dir, rel) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const childAbs = path.join(dir, e.name);
      const childRel = path.join(rel, e.name);
      if (e.isDirectory()) {
        walk(childAbs, childRel);
      } else if (e.isFile()) {
        try {
          const stat = fs.statSync(childAbs);
          const sha256 = stat.size < MAX_FILE_BYTES ? sha256File(childAbs) : null;
          files.push({ path: childRel, sha256, size: stat.size });
        } catch (_) {}
      }
    }
  }

  walk(fp, '');
  files.sort((a, b) => a.path.localeCompare(b.path));

  const manifestContent = files
    .map(f => `${f.sha256 || 'TOO_LARGE'}  ${f.path}  ${f.size}`)
    .join('\n');
  const manifest_sha256 = sha256Str(manifestContent);

  return { root: p, files, manifest_sha256 };
}

function tool_fs_self() {
  // Self-describing: report own hash, capabilities, config
  const selfPath = __filename;
  const selfHash = sha256File(selfPath);
  const selfStat = fs.statSync(selfPath);
  return {
    name:         'SOVEREIGN-FS-MCP',
    version:      '1.0.0',
    sha256:       selfHash,
    size:         selfStat.size,
    root:         ROOT_DIR,
    read_only:    READ_ONLY,
    max_bytes:    MAX_FILE_BYTES,
    capabilities: ['ipc_rpc', 'fs_read', 'fs_write'],
    deps:         [],
    credentials:  [],
  };
}

// ── Tool registry ─────────────────────────────────────────────────────────────

const TOOLS = {
  fs_read:     { fn: tool_fs_read,     desc: 'Read file content + SHA256',                readOnly: true  },
  fs_write:    { fn: tool_fs_write,    desc: 'Write file, return SHA256',                 readOnly: false },
  fs_list:     { fn: tool_fs_list,     desc: 'List directory entries with hashes',        readOnly: true  },
  fs_exists:   { fn: tool_fs_exists,   desc: 'Check if path exists',                     readOnly: true  },
  fs_delete:   { fn: tool_fs_delete,   desc: 'Delete file or directory',                 readOnly: false },
  fs_mkdir:    { fn: tool_fs_mkdir,    desc: 'Create directory (recursive)',              readOnly: false },
  fs_manifest: { fn: tool_fs_manifest, desc: 'Content-addressed manifest of a directory',readOnly: true  },
  fs_self:     { fn: tool_fs_self,     desc: 'Self-describing: version, hash, caps',     readOnly: true  },
};

const TOOL_LIST = Object.entries(TOOLS).map(([name, { desc, readOnly }]) => ({
  name,
  description: desc,
  annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly },
  inputSchema: { type: 'object', properties: {}, additionalProperties: true },
}));

// ── MCP JSON-RPC stdio transport ──────────────────────────────────────────────

let msgId = 0;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handleRequest(req) {
  const { method, params, id } = req;

  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'SOVEREIGN-FS-MCP', version: '1.0.0' },
      },
    });
  }

  if (method === 'notifications/initialized') return; // no reply

  if (method === 'tools/list') {
    return send({
      jsonrpc: '2.0', id,
      result: { tools: TOOL_LIST },
    });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    const tool = TOOLS[name];
    if (!tool) {
      return send({
        jsonrpc: '2.0', id,
        error: { code: -32601, message: 'Unknown tool: ' + name },
      });
    }
    try {
      const result = tool.fn(args || {});
      return send({
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      });
    } catch (e) {
      return send({
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: 'ERROR: ' + e.message }],
          isError: true,
        },
      });
    }
  }

  // Unknown method
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (require.main === module) {
  process.stderr.write('SOVEREIGN-FS-MCP v1.0.0\n');
  process.stderr.write('root:      ' + ROOT_DIR + '\n');
  process.stderr.write('read_only: ' + READ_ONLY + '\n');
  process.stderr.write('max_bytes: ' + MAX_FILE_BYTES + '\n');

  // Self-integrity check on startup
  const selfHash = sha256File(__filename);
  process.stderr.write('self_sha256: ' + selfHash + '\n');

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  let buf = '';

  rl.on('line', line => {
    buf += line;
    try {
      const req = JSON.parse(buf);
      buf = '';
      handleRequest(req);
    } catch (_) {
      // accumulate if partial
    }
  });

  rl.on('close', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

module.exports = { tool_fs_read, tool_fs_write, tool_fs_list, tool_fs_manifest, tool_fs_self, safePath, sha256File };
