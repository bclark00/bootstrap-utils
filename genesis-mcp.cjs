#!/usr/bin/env node
'use strict';
/**
 * genesis-mcp.cjs -- Genesis Bootstrap Context MCP Server
 *
 * The first MCP registered. Fires before anything else.
 * Gives a fresh session its complete operational context:
 *   - Node identity (who am I, what can I do)
 *   - Message queue (what work is waiting)
 *   - ARDS substrate (chain state, provenance)
 *   - Constitutional corpus (Guardian Invariants)
 *   - Topology (what nodes exist, what's reachable)
 *
 * Tools:
 *   get_node_identity      -- this node's id, role, capabilities
 *   get_topology           -- all known nodes + reachability
 *   get_pending_messages   -- queue filtered to this node
 *   claim_message          -- lock a message for this node/session
 *   complete_message       -- move claimed -> processed with result
 *   fail_message           -- move claimed -> failed with error
 *   get_constitution       -- Guardian Invariants from genesis-docs
 *   get_ards_stats         -- ARDS chain state
 *   emit_bootstrap_receipt -- attest session start to ARDS chain
 *
 * Copyright (C) 2026 Brandon Clark. All Rights Reserved.
 */

const { Server }               = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const fs      = require('fs').promises;
const os      = require('os');
const path    = require('path');
const https   = require('https');
const { spawnSync } = require('child_process');

// ── Config ───────────────────────────────────────────────────────────────────

const BC_TOKEN  = process.env.BC_TOKEN  || 'PLACEHOLDER_BC_TOKEN';
const PV_TOKEN  = process.env.PV_TOKEN  || 'PLACEHOLDER_PV_TOKEN';
const HOME      = os.homedir();
const HOSTNAME  = os.hostname().toLowerCase();

const BOOTSTRAP_REPO  = 'bclark00/exponential-session-bootstrap';
const GENESIS_DOCS    = 'bclark00/genesis-docs';
const SHARDS_REPO     = 'Primevelocity/session-crystallization';
const ARDS_JS         = path.join(HOME, 'ards.js');
const TOPOLOGY_FILE   = path.join(HOME,
  'primevelocity-from-nested/.exponential-infrastructure/ards-topology.json');

// Claim TTL: reclaim abandoned messages after 10 minutes
const CLAIM_TTL_MS = 10 * 60 * 1000;

// ── Node topology (canonical) ─────────────────────────────────────────────────

const KNOWN_NODES = {
  'zorin-imac':       { ip: '192.168.1.155', role: 'primary-dev',    os: 'linux',   caps: ['ards', 'ollama', 'gpu:none', 'kernel-modules'] },
  'rtx3060':          { ip: '10.27.1.155',   role: 'gpu-compute',    os: 'windows', caps: ['gpu:rtx3060', 'ollama', 'wsl2'] },
  'garage':           { ip: '10.27.1.176',   role: 'sql-storage',    os: 'windows', caps: ['sql-server', 'wsl2'] },
  'claudebrain-left': { ip: '10.27.1.116',   role: 'memory-primary', os: 'macos',   caps: ['postgres', 'git-mirror'] },
  'claudebrain-right':{ ip: '10.27.1.44',    role: 'memory-replica', os: 'macos',   caps: ['postgres', 'git-mirror'] },
  'openwrt-gateway':  { ip: '192.168.1.1',   role: 'coordinator',    os: 'openwrt', caps: ['ards-witness', 'routing'] },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function ghFetch(path, token, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'genesis-mcp/1.0',
      },
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function b64enc(str) { return Buffer.from(str).toString('base64'); }
function b64dec(str) { return Buffer.from(str, 'base64').toString('utf8'); }

function resolveNodeId() {
  // Try exact match first, then prefix match
  for (const [id] of Object.entries(KNOWN_NODES)) {
    if (HOSTNAME === id || HOSTNAME.startsWith(id.split('-')[0])) return id;
  }
  // Fallback: return hostname as-is
  return HOSTNAME;
}

function ardsStats() {
  try {
    const ards = require(ARDS_JS);
    // stats() is async — return a promise string for sync callers
    return ards.stats();
  } catch {
    return Promise.resolve({ error: 'ards.js not available', total_entries: null });
  }
}

function ardsSubmit(type, key, payload) {
  try {
    const ards = require(ARDS_JS);
    return ards.submit(type, key, payload);
  } catch (e) {
    return Promise.resolve({ error: e.message });
  }
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolGetNodeIdentity() {
  const node_id = resolveNodeId();
  const node    = KNOWN_NODES[node_id] || { ip: 'unknown', role: 'unknown', os: os.platform(), caps: [] };
  return {
    node_id,
    hostname : HOSTNAME,
    ip       : node.ip,
    role     : node.role,
    os       : node.os,
    caps     : node.caps,
    platform : `${os.platform()} ${os.arch()}`,
    uptime_s : Math.floor(os.uptime()),
  };
}

async function toolGetTopology() {
  // Ping-check local nodes (quick, 1-packet)
  const nodes = {};
  for (const [id, info] of Object.entries(KNOWN_NODES)) {
    let reachable = null;
    try {
      const r = spawnSync('ping', ['-c', '1', '-W', '1', info.ip], { timeout: 2000 });
      reachable = r.status === 0;
    } catch { reachable = false; }
    nodes[id] = { ...info, reachable };
  }

  // Try to load extended topology from file
  let extended = null;
  try {
    extended = JSON.parse(await fs.readFile(TOPOLOGY_FILE, 'utf8'));
  } catch { /* not fatal */ }

  return { current_node: resolveNodeId(), nodes, extended };
}

async function toolGetPendingMessages({ target_node = null } = {}) {
  const node_id = resolveNodeId();
  const r = await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/messages/pending`, BC_TOKEN);
  if (r.status !== 200) return { error: `GitHub ${r.status}`, messages: [] };

  const now = Date.now();
  const messages = [];

  for (const file of r.body) {
    if (!file.name.endsWith('.json')) continue;
    try {
      const fr = await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/messages/pending/${file.name}`, BC_TOKEN);
      const msg = JSON.parse(b64dec(fr.body.content));
      // Filter: accept if no target, or target matches this node
      const tgt = msg.target_node || null;
      if (tgt && tgt !== node_id) continue;
      if (target_node && tgt !== target_node) continue;
      messages.push({ ...msg, _sha: fr.body.sha, _path: `messages/pending/${file.name}` });
    } catch { /* skip malformed */ }
  }

  // Also surface stale claims (abandoned by crashed sessions)
  try {
    const cr = await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/messages/claimed`, BC_TOKEN);
    if (cr.status === 200) {
      for (const file of cr.body) {
        if (!file.name.endsWith('.json')) continue;
        try {
          const fr = await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/messages/claimed/${file.name}`, BC_TOKEN);
          const msg = JSON.parse(b64dec(fr.body.content));
          const age = now - new Date(msg.claimed_at).getTime();
          if (age > CLAIM_TTL_MS) {
            messages.push({ ...msg, _sha: fr.body.sha, _path: `messages/claimed/${file.name}`, _stale_claim: true });
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* claimed dir may not exist yet */ }

  return { node_id, messages };
}

async function toolClaimMessage({ message_id, session_id = null }) {
  const node_id = resolveNodeId();
  const src = `messages/pending/${message_id}`;

  // Read current message
  const r = await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/${src}`, BC_TOKEN);
  if (r.status !== 200) return { error: `message not found: ${message_id}` };

  const msg = JSON.parse(b64dec(r.body.content));
  const sha = r.body.sha;

  // Add claim metadata
  msg.claimed_by   = node_id;
  msg.claimed_at   = new Date().toISOString();
  msg.session_id   = session_id || `${node_id}-${Date.now()}`;

  const dst = `messages/claimed/${message_id}`;

  // Write to claimed/
  const wr = await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/${dst}`, BC_TOKEN, 'PUT', {
    message : `msg: [claim] ${message_id} -> ${node_id}`,
    content : b64enc(JSON.stringify(msg, null, 2)),
    branch  : 'main',
  });
  if (wr.status !== 201 && wr.status !== 200) return { error: `claim write failed: ${wr.status}` };

  // Delete from pending/
  await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/${src}`, BC_TOKEN, 'DELETE', {
    message : `msg: [claim] remove from pending ${message_id}`,
    sha,
    branch  : 'main',
  });

  return { ok: true, message_id, claimed_by: node_id, session_id: msg.session_id };
}

async function toolCompleteMessage({ message_id, result = {} }) {
  const node_id = resolveNodeId();
  const src = `messages/claimed/${message_id}`;

  const r = await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/${src}`, BC_TOKEN);
  if (r.status !== 200) return { error: `claimed message not found: ${message_id}` };

  const msg  = JSON.parse(b64dec(r.body.content));
  const sha  = r.body.sha;

  msg.processed_at = new Date().toISOString();
  msg.processed_by = node_id;
  msg.result       = result;

  const dst = `messages/processed/${message_id}`;

  const wr = await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/${dst}`, BC_TOKEN, 'PUT', {
    message : `msg: [done] ${message_id} by ${node_id}`,
    content : b64enc(JSON.stringify(msg, null, 2)),
    branch  : 'main',
  });
  if (wr.status !== 201 && wr.status !== 200) return { error: `complete write failed: ${wr.status}` };

  await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/${src}`, BC_TOKEN, 'DELETE', {
    message : `msg: [done] remove from claimed ${message_id}`,
    sha,
    branch  : 'main',
  });

  return { ok: true, message_id, processed_by: node_id };
}

async function toolFailMessage({ message_id, error_msg }) {
  const node_id = resolveNodeId();
  const src = `messages/claimed/${message_id}`;

  const r = await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/${src}`, BC_TOKEN);
  if (r.status !== 200) return { error: `claimed message not found: ${message_id}` };

  const msg = JSON.parse(b64dec(r.body.content));
  const sha = r.body.sha;

  msg.failed_at  = new Date().toISOString();
  msg.failed_by  = node_id;
  msg.error      = error_msg;

  const dst = `messages/failed/${message_id}`;
  await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/${dst}`, BC_TOKEN, 'PUT', {
    message : `msg: [fail] ${message_id}: ${error_msg.slice(0, 60)}`,
    content : b64enc(JSON.stringify(msg, null, 2)),
    branch  : 'main',
  });

  await ghFetch(`/repos/${BOOTSTRAP_REPO}/contents/${src}`, BC_TOKEN, 'DELETE', {
    message: `msg: [fail] remove from claimed ${message_id}`,
    sha,
    branch: 'main',
  });

  return { ok: true, message_id, failed_by: node_id };
}

async function toolGetConstitution() {
  const path = 'rfcs/GENESIS-CONSTITUTION-GUARDIAN-INVARIANTS-v1.md';
  const r = await ghFetch(`/repos/${GENESIS_DOCS}/contents/${path}`, BC_TOKEN);
  if (r.status !== 200) return { error: `constitution fetch failed: ${r.status}` };
  return {
    path,
    sha     : r.body.sha.slice(0, 16),
    content : b64dec(r.body.content),
  };
}

async function toolGetArdsStats() {
  const stats = await ardsStats();
  return stats;
}

async function toolEmitBootstrapReceipt({ context = {} }) {
  const node_id = resolveNodeId();
  const receipt = {
    event    : 'SESSION_BOOTSTRAP',
    node_id,
    hostname : HOSTNAME,
    ts       : new Date().toISOString(),
    context,
  };
  const result = await ardsSubmit(0x04, `bootstrap:${node_id}`, receipt);
  return { ok: !result.error, seq: result.seq, receipt_id: result.receipt?.receipt_id, node_id };
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'genesis-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_node_identity',
      description: 'Get this node\'s identity: node_id, role, capabilities, IP. Call first in every session.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_topology',
      description: 'Get all known nodes with reachability ping-check.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_pending_messages',
      description: 'Get queued work from the bucket brigade message queue, filtered to this node.',
      inputSchema: {
        type: 'object',
        properties: {
          target_node: { type: 'string', description: 'Filter to a specific node_id (optional)' },
        },
      },
    },
    {
      name: 'claim_message',
      description: 'Atomically claim a pending message for this node. Must claim before executing.',
      inputSchema: {
        type: 'object',
        properties: {
          message_id : { type: 'string', description: 'Filename from pending queue e.g. 2026-02-21T143001Z-catabolize-scout.json' },
          session_id : { type: 'string', description: 'Optional session identifier' },
        },
        required: ['message_id'],
      },
    },
    {
      name: 'complete_message',
      description: 'Mark a claimed message as successfully completed.',
      inputSchema: {
        type: 'object',
        properties: {
          message_id : { type: 'string' },
          result     : { type: 'object', description: 'Result payload' },
        },
        required: ['message_id'],
      },
    },
    {
      name: 'fail_message',
      description: 'Mark a claimed message as failed with error context.',
      inputSchema: {
        type: 'object',
        properties: {
          message_id : { type: 'string' },
          error_msg  : { type: 'string' },
        },
        required: ['message_id', 'error_msg'],
      },
    },
    {
      name: 'get_constitution',
      description: 'Fetch the Genesis Guardian Invariants constitution from genesis-docs. Load before any mutation.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_ards_stats',
      description: 'Get ARDS kernel substrate chain statistics: entry count, head hash, uptime.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'emit_bootstrap_receipt',
      description: 'Attest this session\'s bootstrap to the ARDS hash chain (INV-2 provenance).',
      inputSchema: {
        type: 'object',
        properties: {
          context: { type: 'object', description: 'Session context to include in receipt' },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  let result;
  try {
    switch (name) {
      case 'get_node_identity'     : result = await toolGetNodeIdentity();             break;
      case 'get_topology'          : result = await toolGetTopology();                 break;
      case 'get_pending_messages'  : result = await toolGetPendingMessages(args);      break;
      case 'claim_message'         : result = await toolClaimMessage(args);            break;
      case 'complete_message'      : result = await toolCompleteMessage(args);         break;
      case 'fail_message'          : result = await toolFailMessage(args);             break;
      case 'get_constitution'      : result = await toolGetConstitution();             break;
      case 'get_ards_stats'        : result = await toolGetArdsStats();                break;
      case 'emit_bootstrap_receipt': result = await toolEmitBootstrapReceipt(args);    break;
      default: result = { error: `unknown tool: ${name}` };
    }
  } catch (e) {
    result = { error: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[genesis-mcp] ready\n');
}

main().catch(e => { process.stderr.write(`[genesis-mcp] fatal: ${e.message}\n`); process.exit(1); });
