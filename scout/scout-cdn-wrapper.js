#!/usr/bin/env node
/**
 * Scout-CDN: Homogenized Scout MCP wrapper
 * Integrates Scout filesystem intelligence with tool-cdn / ExeRay analysis.
 * Eliminates hard dependency on C:\Genesis\scout\scout\src - loads adaptively.
 * Adds: binary analysis via ExeRay IPC, health recording to GenesisDB.
 * 
 * Genesis Infrastructure | Scout + tool-cdn fusion | 2026-02-21
 */
'use strict';

const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { execSync, spawn } = require('child_process');
const os      = require('os');

// ── Config ─────────────────────────────────────────────────────────────────
const SCOUT_DB      = process.env.SCOUT_DB_PATH   || 'C:\\Genesis\\scout\\scout\\db\\scout.db';
const BACKUP_DIR    = process.env.SCOUT_BACKUP_DIR || 'C:\\Genesis\\scout\\scout\\.scout-backup';
const SCOUT_SRC     = 'C:\\Genesis\\scout\\scout\\src';
const SESSION_ID    = crypto.randomBytes(6).toString('hex');
const START_TIME    = Date.now();

// ── SQL helper (health recording) ──────────────────────────────────────────
function recordHealth(status, latency_ms, detail) {
  try {
    const msg = (detail||'').replace(/'/g,"''").replace(/\n/g,' ').slice(0,500);
    execSync(
      `sqlcmd -S localhost -d GenesisDB -E -Q "INSERT INTO health_checks (service_name,service_type,host,status,latency_ms,message,checked_by) VALUES ('scout','mcp-server','localhost','${status}',${latency_ms},'${msg}','scout-self')" -h -1`,
      { stdio:'pipe', timeout:3000 }
    );
  } catch {}
}

// ── Adaptive loader: try native Scout, fall back to embedded impl ──────────
let ScoutImpl = null;

function loadScoutNative() {
  const serverPath = path.join(SCOUT_SRC, 'interfaces', 'scout-mcp-server.js');
  if (!fs.existsSync(serverPath)) return false;
  try {
    const { ScoutMCPServer } = require(serverPath);
    ScoutImpl = new ScoutMCPServer({ dbPath: SCOUT_DB, backupDir: BACKUP_DIR });
    return true;
  } catch { return false; }
}

// ── Embedded lite impl (zero deps, used when native Scout unavailable) ────
const Database = (() => {
  // Check if better-sqlite3 is available anywhere in the Scout dir
  const candidates = [
    path.join(SCOUT_SRC, '..', 'node_modules', 'better-sqlite3'),
    'better-sqlite3',
  ];
  for (const c of candidates) {
    try { return require(c); } catch {}
  }
  return null;
})();

function sqliteQuery(sql, params = []) {
  if (!Database) return { error: 'no sqlite driver' };
  try {
    const db = new Database(SCOUT_DB, { readonly: true, fileMustExist: true });
    const stmt = db.prepare(sql);
    const rows = params.length ? stmt.all(...params) : stmt.all();
    db.close();
    return { rows };
  } catch(e) {
    return { error: e.message };
  }
}

// ── ExeRay integration via tool-cdn IPC ────────────────────────────────────
function callExeRay(operation, filePath) {
  return new Promise((resolve) => {
    const exerayServer = 'C:\\Users\\sethi\\tool-cdn\\exeray-mcp-server.js';
    if (!fs.existsSync(exerayServer)) return resolve({ error: 'ExeRay not found' });
    
    const proc = spawn('node', [exerayServer], { stdio: ['pipe','pipe','pipe'] });
    let buf = '';
    const timer = setTimeout(() => { proc.kill(); resolve({ error: 'timeout' }); }, 8000);
    
    proc.stdout.on('data', chunk => {
      buf += chunk.toString();
      const m = buf.match(/Content-Length:\s*(\d+)\r?\n\r?\n/);
      if (!m) return;
      const len = parseInt(m[1]);
      const start = buf.indexOf(m[0]) + m[0].length;
      if (buf.length < start + len) return;
      const body = buf.slice(start, start + len);
      clearTimeout(timer);
      try {
        const msg = JSON.parse(body);
        // Get next response (the actual tool result)
        const toolReq = JSON.stringify({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name: operation, arguments:{ path: filePath }}});
        proc.stdin.write(`Content-Length: ${Buffer.byteLength(toolReq)}\r\n\r\n${toolReq}`);
        
        let buf2 = '';
        proc.stdout.removeAllListeners('data');
        proc.stdout.on('data', chunk2 => {
          buf2 += chunk2.toString();
          const m2 = buf2.match(/Content-Length:\s*(\d+)\r?\n\r?\n/);
          if (!m2) return;
          const l2 = parseInt(m2[1]);
          const s2 = buf2.indexOf(m2[0]) + m2[0].length;
          if (buf2.length < s2 + l2) return;
          clearTimeout(timer);
          proc.kill();
          try { resolve(JSON.parse(buf2.slice(s2, s2+l2))); }
          catch { resolve({ error: 'bad response' }); }
        });
      } catch { proc.kill(); resolve({ error: 'bad init response' }); }
    });
    
    // Initialize ExeRay
    const init = JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', clientInfo:{ name:'scout-cdn' }, capabilities:{}}});
    proc.stdin.write(`Content-Length: ${Buffer.byteLength(init)}\r\n\r\n${init}`);
  });
}

// ── Tool implementations ───────────────────────────────────────────────────
const TOOLS = {};

// If native Scout loaded, delegate
if (loadScoutNative()) {
  recordHealth('healthy', Date.now() - START_TIME, 'native Scout loaded');
  
  TOOLS.scout_search    = (args) => ScoutImpl.handleSearch(args);
  TOOLS.scout_index     = (args) => ScoutImpl.handleIndex(args);
  TOOLS.scout_operations= (args) => ScoutImpl.handleOperations(args);
  TOOLS.scout_rollback  = (args) => ScoutImpl.handleRollback(args);
  TOOLS.scout_registry  = (args) => ScoutImpl.handleRegistry(args);
} else {
  // Embedded lite implementations
  recordHealth('degraded', Date.now() - START_TIME, 'native Scout unavailable, running embedded lite');
  
  TOOLS.scout_search = ({ query, extensions, max_results = 50 }) => {
    if (!query) return { error: 'query required' };
    const ext = extensions ? `AND extension IN (${extensions.map(e=>`'${e}'`).join(',')})` : '';
    const r = sqliteQuery(
      `SELECT path, name, extension, size, mtime FROM file_index WHERE name LIKE ? ${ext} LIMIT ?`,
      [`%${query}%`, max_results]
    );
    return r.error ? { error: r.error, fallback: 'Use illuminaughty_search for filesystem search' } : { results: r.rows, count: r.rows?.length };
  };

  TOOLS.scout_index = ({ directory }) => {
    return { status: 'lite mode', message: `Use scout_search; indexing requires native Scout. Dir: ${directory}` };
  };

  TOOLS.scout_registry = ({ action = 'list' }) => {
    const r = sqliteQuery('SELECT id, name, type, location, health_status, usage_count FROM registry_components ORDER BY usage_count DESC');
    return r.error ? { error: r.error } : { components: r.rows };
  };

  TOOLS.scout_operations = ({ operation, path: p, destination }) => {
    return { status: 'lite mode', message: 'File operations require native Scout' };
  };

  TOOLS.scout_rollback = ({ operation_id }) => {
    const r = sqliteQuery('SELECT * FROM operations_log WHERE id=? AND operation IN (\'write\',\'move\',\'delete\') AND status=\'success\'', [operation_id]);
    return r.error ? { error: r.error } : { candidate: r.rows?.[0] };
  };
}

// ── CDN-extended tools (always available) ──────────────────────────────────
TOOLS.scout_analyze_binary = async ({ path: filePath }) => {
  if (!filePath || !fs.existsSync(filePath)) return { error: `File not found: ${filePath}` };
  const stats = fs.statSync(filePath);
  const exerayResult = await callExeRay('exeray_analyze', filePath);
  return {
    path: filePath,
    size: stats.size,
    modified: stats.mtime,
    exeray: exerayResult?.result || exerayResult,
  };
};

TOOLS.scout_health = () => {
  const uptime = Date.now() - START_TIME;
  const mode = ScoutImpl ? 'native' : 'embedded-lite';
  const dbExists = fs.existsSync(SCOUT_DB);
  const dbSize = dbExists ? fs.statSync(SCOUT_DB).size : 0;
  recordHealth('healthy', uptime > 9999 ? 9999 : uptime, `mode=${mode} uptime=${uptime}ms`);
  return { status:'healthy', mode, session_id: SESSION_ID, uptime_ms: uptime, db: { path: SCOUT_DB, exists: dbExists, size_bytes: dbSize }};
};

TOOLS.scout_cache_stats = () => {
  const r = sqliteQuery('SELECT total_entries, total_hits, avg_hits_per_entry, valid_entries, expired_entries FROM cache_stats');
  return r.error ? { error: r.error } : { cache: r.rows?.[0] };
};

TOOLS.scout_db_stats = () => {
  const idx = sqliteQuery('SELECT total_files, total_size, unique_extensions, last_index_time, content_indexed_count FROM index_stats');
  const ops = sqliteQuery('SELECT COUNT(*) as total, SUM(CASE WHEN status=\'success\' THEN 1 ELSE 0 END) as success FROM operations_log');
  return {
    index: idx.rows?.[0] || idx.error,
    operations: ops.rows?.[0] || ops.error,
    db_path: SCOUT_DB,
    db_size_bytes: fs.existsSync(SCOUT_DB) ? fs.statSync(SCOUT_DB).size : 0,
  };
};

// ── Tool definitions for MCP ───────────────────────────────────────────────
const TOOL_DEFS = {
  scout_search:          { description:'Search indexed files by name, extension, or pattern', inputSchema:{ type:'object', required:['query'], properties:{ query:{type:'string'}, extensions:{type:'array',items:{type:'string'}}, max_results:{type:'number'}}}},
  scout_index:           { description:'Index a directory for fast searching', inputSchema:{ type:'object', required:['directory'], properties:{ directory:{type:'string'}}}},
  scout_operations:      { description:'Safe file operations (read/write/move/delete/copy) with automatic backup', inputSchema:{ type:'object', required:['operation','path'], properties:{ operation:{type:'string',enum:['read','write','move','delete','copy']}, path:{type:'string'}, destination:{type:'string'}, content:{type:'string'}}}},
  scout_rollback:        { description:'Roll back a file operation using backup', inputSchema:{ type:'object', required:['operation_id'], properties:{ operation_id:{type:'number'}}}},
  scout_registry:        { description:'Component registry - list, register, or query components', inputSchema:{ type:'object', properties:{ action:{type:'string',enum:['list','get','register']}, component_id:{type:'string'}}}},
  scout_analyze_binary:  { description:'Analyze a binary file using ExeRay (PE/ELF analysis, capability extraction)', inputSchema:{ type:'object', required:['path'], properties:{ path:{type:'string',description:'Absolute path to binary'}}}},
  scout_health:          { description:'Get Scout health status, mode, and DB stats', inputSchema:{ type:'object', properties:{}}},
  scout_cache_stats:     { description:'Get search cache statistics', inputSchema:{ type:'object', properties:{}}},
  scout_db_stats:        { description:'Get file index and operations statistics', inputSchema:{ type:'object', properties:{}}},
};

// ── MCP stdio ──────────────────────────────────────────────────────────────
const send  = (obj) => { const b = JSON.stringify(obj); process.stdout.write(`Content-Length: ${Buffer.byteLength(b)}\r\n\r\n${b}`); };
const sendErr = (id, code, msg) => send({ jsonrpc:'2.0', id, error:{ code, message:msg }});
const sendOk  = (id, result) => send({ jsonrpc:'2.0', id, result });

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  while (true) {
    const m = buf.match(/Content-Length:\s*(\d+)\r?\n\r?\n/);
    if (!m) break;
    const len   = parseInt(m[1]);
    const start = buf.indexOf(m[0]) + m[0].length;
    if (buf.length < start + len) break;
    const body  = buf.slice(start, start + len);
    buf = buf.slice(start + len);
    let msg; try { msg = JSON.parse(body); } catch { continue; }

    if (msg.method === 'initialize') {
      sendOk(msg.id, { protocolVersion:'2024-11-05', serverInfo:{ name:'scout-cdn', version:'2.0.0', mode: ScoutImpl ? 'native' : 'lite' }, capabilities:{ tools:{} }});
    } else if (msg.method === 'tools/list') {
      sendOk(msg.id, { tools: Object.entries(TOOL_DEFS).map(([name,def]) => ({ name, ...def })) });
    } else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      const fn = TOOLS[name];
      if (!fn) { sendErr(msg.id, -32601, `Unknown tool: ${name}`); continue; }
      const t0 = Date.now();
      Promise.resolve().then(() => fn(args||{})).then(result => {
        const ms = Date.now() - t0;
        if (ms > 2000) recordHealth('degraded', ms, `slow tool call: ${name}`);
        sendOk(msg.id, { content:[{ type:'text', text: JSON.stringify(result,null,2) }] });
      }).catch(e => {
        recordHealth('unhealthy', Date.now()-t0, `tool error ${name}: ${e.message}`);
        sendOk(msg.id, { content:[{ type:'text', text:'Error: '+e.message }], isError:true });
      });
    } else if (msg.id !== undefined) {
      sendErr(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('uncaughtException', e => {
  recordHealth('unhealthy', 0, e.message);
  process.stderr.write(`scout-cdn error: ${e.message}\n`);
});
