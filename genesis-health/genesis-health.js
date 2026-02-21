#!/usr/bin/env node
/**
 * Genesis Health Probe MCP Server
 * Probes all registered MCP servers, records to GenesisDB.health_checks + mcp_tool_calls.
 * Zero npm dependencies - pure Node.js net + child_process.
 * 
 * Genesis Infrastructure | GenesisDB | 2026-02-21
 */
'use strict';

const { execSync, spawn } = require('child_process');
const net    = require('net');
const crypto = require('crypto');
const os     = require('os');
const fs     = require('fs');
const path   = require('path');

// ── SQL helper ─────────────────────────────────────────────────────────────
function sqlcmd(sql, db = 'GenesisDB') {
  try {
    const out = execSync(
      `sqlcmd -S localhost -d ${db} -E -Q "${sql.replace(/\n/g,' ').replace(/"/g,'\\"')}" -h -1 -W`,
      { stdio:['pipe','pipe','pipe'], timeout:8000 }
    ).toString().trim();
    return { ok:true, data: out };
  } catch(e) {
    return { ok:false, error: e.stderr?.toString() || e.message };
  }
}

// ── MCP server registry ─────────────────────────────────────────────────────
const MCP_SERVERS = [
  { key:'PRIME_VELOCITY',   name:'prime-velocity-omnipotence', exe:'node', args:['C:\\Users\\sethi\\.claude-mcp-servers\\prime-velocity-omnipotence-stdio-fix.js'] },
  { key:'AUDIT_NEXUS',      name:'audit-nexus',                exe:'node', args:['C:\\Users\\sethi\\audit-nexus\\mcp-server.js'] },
  { key:'SCOUT',            name:'scout',                      exe:'node', args:['C:\\Genesis\\scout\\scout-mcp-wrapper.js'] },
  { key:'VAULT',            name:'vault',                      exe:'node', args:['C:\\Users\\sethi\\vault-mcp\\vault-mcp.js'] },
  { key:'TOOL_CDN',         name:'tool-cdn',                   exe:'node', args:['C:\\Users\\sethi\\tool-cdn\\exeray-mcp-server.js'] },
  { key:'PATTERN_REGISTRY', name:'pattern-registry',           exe:'node', args:['C:\\Users\\sethi\\GitHub-Repos\\exponential-systems\\orchestration\\patterns-mcp-server.cjs'] },
  { key:'CONDUIT',          name:'conduit',                    exe:'node', args:['C:\\Users\\sethi\\conduit\\conduit-mcp-server.js'] },
  { key:'ILLUMINAUGHTY',    name:'illuminaughty',              exe:'node', args:['C:\\Users\\sethi\\EverythingMCP-Deploy\\illuminaughty-mcp-server.js'] },
  { key:'MTRANSPORT',       name:'mtransport-v5-streaming',    exe:'node', args:['C:\\Users\\sethi\\mtransport-v5-cascade\\mcp-streaming-server.js'] },
  { key:'WEBSOCKET_BRIDGE', name:'websocket-bridge',           exe:'node', args:['C:\\Users\\sethi\\mcp-websocket-bridge\\src\\bridge-fixed.js'] },
  { key:'EXPONENTIAL_SYS',  name:'exponential-system',         exe:'node', args:['C:\\Users\\sethi\\IntegratedExponentialSystem\\exponential-mcp-unified.js'] },
  { key:'WINDOWS_FILES',    name:'windows-files',              exe:'node', args:['C:\\Users\\sethi\\windows-file-mcp-server.js'] },
  { key:'INFRASTRUCTURE',   name:'infrastructure',             exe:'python', args:['-m','infrastructure_mcp_server'], cwd:'C:\\Users\\sethi\\infrastructure-mcp' },
];

// ── Probe: send MCP initialize and measure latency ─────────────────────────
function probeMcpServer(server, timeoutMs = 5000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let done = false;
    
    const finish = (status, detail) => {
      if (done) return; done = true;
      const ms = Date.now() - t0;
      clearTimeout(timer);
      try { proc.kill(); } catch {}
      resolve({ key: server.key, name: server.name, status, latency_ms: ms, detail });
    };
    
    const timer = setTimeout(() => finish('timeout', 'No response within ' + timeoutMs + 'ms'), timeoutMs);
    
    let proc;
    try {
      const opts = { stdio:['pipe','pipe','pipe'] };
      if (server.cwd) opts.cwd = server.cwd;
      proc = spawn(server.exe, server.args, opts);
    } catch(e) {
      return finish('unhealthy', 'spawn failed: ' + e.message);
    }
    
    proc.on('error', e => finish('unhealthy', 'process error: ' + e.message));
    proc.on('exit', (code) => { if (!done) finish('unhealthy', 'exited prematurely: ' + code); });
    
    let respBuf = '';
    proc.stdout.on('data', chunk => {
      respBuf += chunk.toString();
      // Look for Content-Length framed response
      const m = respBuf.match(/Content-Length:\s*(\d+)\r?\n\r?\n/);
      if (!m) return;
      const len   = parseInt(m[1]);
      const start = respBuf.indexOf(m[0]) + m[0].length;
      if (respBuf.length < start + len) return;
      const body  = respBuf.slice(start, start + len);
      try {
        const msg = JSON.parse(body);
        if (msg.result?.serverInfo || msg.result?.protocolVersion) {
          finish('healthy', JSON.stringify({ server: msg.result?.serverInfo, proto: msg.result?.protocolVersion }));
        } else {
          finish('degraded', 'unexpected response: ' + body.slice(0,100));
        }
      } catch {
        finish('degraded', 'bad JSON in response');
      }
    });
    
    // Send MCP initialize
    const initMsg = JSON.stringify({
      jsonrpc:'2.0', id:1, method:'initialize',
      params:{ protocolVersion:'2024-11-05', clientInfo:{ name:'genesis-health', version:'1.0.0' }, capabilities:{} }
    });
    proc.stdin.write(`Content-Length: ${Buffer.byteLength(initMsg)}\r\n\r\n${initMsg}`);
  });
}

// ── Record results to SQL Server ───────────────────────────────────────────
function recordResults(results, sessionId) {
  const vals = results.map(r => {
    const name = r.name.replace(/'/g,"''");
    const status = r.status;
    const ms = r.latency_ms || 0;
    const msg = (r.detail || '').replace(/'/g,"''").slice(0,500);
    const svc = 'mcp-server';
    return `('${name}','${svc}','localhost','${status}',${ms},'${msg}','genesis-health')`;
  }).join(',\n');

  sqlcmd(`INSERT INTO health_checks (service_name,service_type,host,status,latency_ms,message,checked_by)
VALUES ${vals}`);

  // Also update systems table
  results.forEach(r => {
    const sqlStatus = r.status === 'healthy' ? 'DEPLOYED' : r.status === 'timeout' ? 'UNKNOWN' : 'DEGRADED';
    sqlcmd(`UPDATE systems SET current_status='${sqlStatus}', last_verified=SYSUTCDATETIME(), verified_by='genesis-health'
WHERE system_key='${r.key}'`);
  });
}

// ── Tool implementations ───────────────────────────────────────────────────
const SESSION_ID = crypto.randomBytes(8).toString('hex');

const tools = {
  health_probe_all: async ({ timeout_ms = 5000 } = {}) => {
    const results = await Promise.all(MCP_SERVERS.map(s => probeMcpServer(s, timeout_ms)));
    recordResults(results, SESSION_ID);
    const summary = {
      healthy:   results.filter(r=>r.status==='healthy').map(r=>r.name),
      degraded:  results.filter(r=>r.status==='degraded').map(r=>r.name),
      unhealthy: results.filter(r=>r.status==='unhealthy').map(r=>r.name),
      timeout:   results.filter(r=>r.status==='timeout').map(r=>r.name),
      details:   results.map(r=>({ name:r.name, status:r.status, ms:r.latency_ms })),
    };
    return summary;
  },

  health_probe_one: async ({ name }) => {
    const s = MCP_SERVERS.find(x => x.name === name || x.key === name);
    if (!s) throw new Error(`Unknown server: ${name}`);
    const result = await probeMcpServer(s);
    recordResults([result], SESSION_ID);
    return result;
  },

  health_history: ({ service, limit = 20 }) => {
    const where = service ? `WHERE service_name='${service.replace(/'/g,"''")}'` : '';
    const res = sqlcmd(`SELECT TOP ${limit} service_name, status, latency_ms, ts, message FROM health_checks ${where} ORDER BY ts DESC`);
    return { history: res.data };
  },

  health_summary: () => {
    const res = sqlcmd(`SELECT service_name, status, latency_ms, ts FROM vw_health_latest ORDER BY service_name`);
    const perf = sqlcmd(`SELECT service_name, AVG(latency_ms) as avg_ms, MIN(latency_ms) as min_ms, MAX(latency_ms) as max_ms,
      COUNT(*) as checks, SUM(CASE WHEN status='healthy' THEN 1 ELSE 0 END) as healthy_count
      FROM health_checks WHERE ts >= DATEADD(hour,-24,SYSUTCDATETIME())
      GROUP BY service_name ORDER BY avg_ms DESC`);
    return { latest: res.data, performance_24h: perf.data };
  },

  db_continuity_status: () => {
    const res = sqlcmd(`SELECT source_path, target_db, target_table, sync_status, sync_strategy, last_sync, rows_synced, notes FROM db_continuity ORDER BY target_db, target_table`);
    return { continuity_plan: res.data };
  },

  tool_reliability: () => {
    const res = sqlcmd(`SELECT * FROM vw_tool_reliability ORDER BY total_calls DESC`);
    return { reliability: res.data };
  },
};

// ── MCP stdio ──────────────────────────────────────────────────────────────
const send = (obj) => {
  const body = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const sendErr = (id, code, msg) => send({ jsonrpc:'2.0', id, error:{ code, message:msg }});
const sendOk  = (id, result)    => send({ jsonrpc:'2.0', id, result });

const TOOL_DEFS = {
  health_probe_all: { description:'Probe all registered MCP servers and record results', inputSchema:{ type:'object', properties:{ timeout_ms:{type:'number',description:'Timeout per server in ms (default 5000)'}}}},
  health_probe_one: { description:'Probe a single MCP server by name or key', inputSchema:{ type:'object', required:['name'], properties:{ name:{type:'string'}}}},
  health_history:   { description:'Get health check history for a service', inputSchema:{ type:'object', properties:{ service:{type:'string'}, limit:{type:'number'}}}},
  health_summary:   { description:'Get latest health status for all services + 24h performance', inputSchema:{ type:'object', properties:{}}},
  db_continuity_status: { description:'Show SQLite→SQL Server migration plan and sync status', inputSchema:{ type:'object', properties:{}}},
  tool_reliability: { description:'Show tool call success rates from GenesisDB', inputSchema:{ type:'object', properties:{}}},
};

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
      sendOk(msg.id, { protocolVersion:'2024-11-05', serverInfo:{ name:'genesis-health', version:'1.0.0' }, capabilities:{ tools:{} }});
    } else if (msg.method === 'tools/list') {
      sendOk(msg.id, { tools: Object.entries(TOOL_DEFS).map(([name,def]) => ({ name, ...def })) });
    } else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      const fn = tools[name];
      if (!fn) { sendErr(msg.id, -32601, `Unknown: ${name}`); continue; }
      Promise.resolve().then(() => fn(args||{})).then(result => {
        sendOk(msg.id, { content:[{ type:'text', text: JSON.stringify(result,null,2) }] });
      }).catch(e => {
        sendOk(msg.id, { content:[{ type:'text', text:'Error: '+e.message }], isError:true });
      });
    } else if (msg.id !== undefined) {
      sendErr(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('uncaughtException', e => process.stderr.write(`genesis-health error: ${e.message}\n`));
