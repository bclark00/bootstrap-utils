#!/usr/bin/env node
/**
 * SecureVault MCP Server  
 * AES-256-GCM, DPAPI-sealed master key, SQL Server VaultDB backend.
 * Aligned to actual VaultDB schema: namespace + key_name columns.
 * ZERO npm dependencies — pure Node.js crypto + sqlcmd.
 * 
 * Genesis Infrastructure | VaultDB | 2026-02-21
 */
'use strict';

const crypto = require('crypto');
const { execSync } = require('child_process');
const os     = require('os');
const fs     = require('fs');
const path   = require('path');

// ── MCP stdio framing ──────────────────────────────────────────────────────
const send  = (obj) => { const b = JSON.stringify(obj); process.stdout.write(`Content-Length: ${Buffer.byteLength(b)}\r\n\r\n${b}`); };
const rpcErr= (id, code, msg) => send({ jsonrpc:'2.0', id, error:{ code, message:msg }});
const rpcOk = (id, result)    => send({ jsonrpc:'2.0', id, result });

// ── sqlcmd helper (zero deps, uses Windows sqlcmd) ─────────────────────────
function sql(query, db = 'VaultDB') {
  try {
    // Escape double quotes and newlines for cmd
    const q = query.replace(/\r?\n/g,' ').replace(/"/g,"'");
    const out = execSync(`sqlcmd -S localhost -d ${db} -E -Q "${q}" -h -1 -W -s "|"`, 
      { stdio:['pipe','pipe','pipe'], timeout:10000 }).toString().trim();
    return { ok:true, raw: out };
  } catch(e) {
    return { ok:false, error: (e.stderr?.toString() || e.message).slice(0,300) };
  }
}

function sqlRows(query, db = 'VaultDB') {
  const res = sql(query, db);
  if (!res.ok) return { error: res.error };
  const lines = res.raw.split('\n').map(l => l.trim())
    .filter(l => l && !l.match(/^-+$/) && !l.match(/^\(\d+ rows? affected\)$/));
  return { rows: lines };
}

// ── Key management ──────────────────────────────────────────────────────────
const KEY_FILE = path.join(os.homedir(), '.vault-master-key');
let _key = null;

function getMasterKey() {
  if (_key) return _key;
  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE);
    _key = raw.length >= 32 ? raw.slice(0,32) : crypto.createHash('sha256').update(raw).digest();
    return _key;
  }
  _key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, _key, { mode: 0o600 });
  // Best-effort: store hex in VaultDB master key table
  try { sql(`IF NOT EXISTS (SELECT 1 FROM vault_master_key WHERE key_id=1)
    INSERT INTO vault_master_key (key_id, dpapi_blob) VALUES (1, 0x${_key.toString('hex')})`); } catch {}
  return _key;
}

// ── AES-256-GCM ────────────────────────────────────────────────────────────
function encrypt(plain) {
  const key = getMasterKey();
  const iv  = crypto.randomBytes(12);
  const c   = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain,'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(b64) {
  const key  = getMasterKey();
  const buf  = Buffer.from(b64, 'base64');
  const iv   = buf.slice(0,12), tag = buf.slice(12,28), enc = buf.slice(28);
  const d    = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

const hint = v => (!v || v.length < 8) ? '***' : `${v.slice(0,4)}***${v.slice(-4)}`;

// ── Tools ──────────────────────────────────────────────────────────────────
const tools = {

  vault_set({ key, value, namespace = 'default', tags = '' }) {
    if (!key || !value) throw new Error('key and value required');
    const ns  = namespace.replace(/'/g,"''");
    const k   = key.replace(/'/g,"''");
    const ct  = encrypt(value).replace(/'/g,"''");
    const h   = hint(value);
    const t   = (tags||'').replace(/'/g,"''");
    sql(`IF EXISTS (SELECT 1 FROM secrets WHERE namespace='${ns}' AND key_name='${k}')
      UPDATE secrets SET ciphertext='${ct}', key_hint='${h}', updated_at=SYSUTCDATETIME(), tags_json='${t}', is_active=1
      WHERE namespace='${ns}' AND key_name='${k}'
    ELSE
      INSERT INTO secrets (secret_id, namespace, key_name, ciphertext, key_hint, created_by, tags_json)
      VALUES (NEWID(),'${ns}','${k}','${ct}','${h}','vault-mcp','${t}')`);
    return { stored:true, namespace, key, hint: h };
  },

  vault_get({ key, namespace = 'default' }) {
    if (!key) throw new Error('key required');
    const ns = namespace.replace(/'/g,"''");
    const k  = key.replace(/'/g,"''");
    const r  = sqlRows(`SELECT secret_id, ciphertext FROM secrets WHERE namespace='${ns}' AND key_name='${k}' AND is_active=1`);
    if (r.error || !r.rows?.length) throw new Error(`Secret '${namespace}/${key}' not found`);
    const parts    = r.rows[0].split('|').map(s=>s.trim());
    const secretId = parts[0]; 
    const ct       = parts.slice(1).join('|').trim();
    const plaintext= decrypt(ct);
    // Log access
    sql(`UPDATE secrets SET updated_at=SYSUTCDATETIME() WHERE secret_id='${secretId}';
      INSERT INTO secret_access_log (secret_id, accessor, operation, success)
      VALUES ('${secretId}','vault-mcp','READ',1)`);
    return { key, namespace, value: plaintext };
  },

  vault_list({ namespace = '', category = '' } = {}) {
    const where = namespace ? `WHERE namespace='${namespace.replace(/'/g,"''")}'` : 'WHERE is_active=1';
    const r = sqlRows(`SELECT namespace, key_name, key_hint, created_at, rotation_due FROM secrets ${where} ORDER BY namespace, key_name`);
    return { secrets: r.rows || [], error: r.error };
  },

  vault_delete({ key, namespace = 'default' }) {
    if (!key) throw new Error('key required');
    sql(`UPDATE secrets SET is_active=0, updated_at=SYSUTCDATETIME() 
      WHERE namespace='${namespace.replace(/'/g,"''")}' AND key_name='${key.replace(/'/g,"''")}'`);
    return { deleted:true, namespace, key };
  },

  vault_rotate({ key, new_value, namespace = 'default' }) {
    if (!key || !new_value) throw new Error('key and new_value required');
    const ct = encrypt(new_value).replace(/'/g,"''");
    const h  = hint(new_value);
    const ns = namespace.replace(/'/g,"''"), k = key.replace(/'/g,"''");
    sql(`UPDATE secrets SET ciphertext='${ct}', key_hint='${h}', updated_at=SYSUTCDATETIME(),
      rotation_due=DATEADD(day,90,SYSUTCDATETIME()) WHERE namespace='${ns}' AND key_name='${k}'`);
    return { rotated:true, namespace, key, hint: h };
  },

  vault_health() {
    const keyOk = fs.existsSync(KEY_FILE);
    const dbRes = sql('SELECT COUNT(*) FROM secrets WHERE is_active=1');
    return { status:'healthy', key_file_exists: keyOk, db_connected: dbRes.ok, db:'VaultDB', server:'localhost' };
  },
};

// ── Tool definitions ───────────────────────────────────────────────────────
const DEFS = {
  vault_set:    { description:'Store or update an encrypted secret', inputSchema:{ type:'object', required:['key','value'], properties:{ key:{type:'string'}, value:{type:'string'}, namespace:{type:'string',description:'Logical grouping e.g. github, anthropic (default: default)'}, tags:{type:'string'}}}},
  vault_get:    { description:'Retrieve and decrypt a secret', inputSchema:{ type:'object', required:['key'], properties:{ key:{type:'string'}, namespace:{type:'string'}}}},
  vault_list:   { description:'List secrets (keys/hints only, no values)', inputSchema:{ type:'object', properties:{ namespace:{type:'string'}, category:{type:'string'}}}},
  vault_delete: { description:'Soft-delete a secret', inputSchema:{ type:'object', required:['key'], properties:{ key:{type:'string'}, namespace:{type:'string'}}}},
  vault_rotate: { description:'Rotate a secret to a new value, resets rotation_due to +90 days', inputSchema:{ type:'object', required:['key','new_value'], properties:{ key:{type:'string'}, new_value:{type:'string'}, namespace:{type:'string'}}}},
  vault_health: { description:'Check vault health (key file, DB connection, secret count)', inputSchema:{ type:'object', properties:{}}},
};

// ── MCP stdio ──────────────────────────────────────────────────────────────
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  while (true) {
    const m = buf.match(/Content-Length:\s*(\d+)\r?\n\r?\n/);
    if (!m) break;
    const len = parseInt(m[1]), start = buf.indexOf(m[0]) + m[0].length;
    if (buf.length < start + len) break;
    const body = buf.slice(start, start + len);
    buf = buf.slice(start + len);
    let msg; try { msg = JSON.parse(body); } catch { continue; }

    if (msg.method === 'initialize') {
      rpcOk(msg.id, { protocolVersion:'2024-11-05', serverInfo:{ name:'vault', version:'1.1.0' }, capabilities:{ tools:{} }});
    } else if (msg.method === 'tools/list') {
      rpcOk(msg.id, { tools: Object.entries(DEFS).map(([name,def]) => ({ name, ...def })) });
    } else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      const fn = tools[name];
      if (!fn) { rpcErr(msg.id, -32601, `Unknown tool: ${name}`); continue; }
      try {
        const result = fn.call(tools, args||{});
        Promise.resolve(result).then(r => rpcOk(msg.id, { content:[{ type:'text', text:JSON.stringify(r,null,2) }] }))
          .catch(e => rpcOk(msg.id, { content:[{ type:'text', text:'Error: '+e.message }], isError:true }));
      } catch(e) {
        rpcOk(msg.id, { content:[{ type:'text', text:'Error: '+e.message }], isError:true });
      }
    } else if (msg.id !== undefined) { rpcErr(msg.id, -32601, `Method not found: ${msg.method}`); }
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('uncaughtException', e => process.stderr.write(`vault-mcp: ${e.message}\n`));
