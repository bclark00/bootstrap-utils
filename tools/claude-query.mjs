#!/usr/bin/env node
/**
 * claude-query.mjs — CAP-010
 * Zero-dependency Anthropic API + claude.ai conversation client.
 *
 * Two modes:
 *   1. INFERENCE  — Anthropic Messages API (sk-ant-api03-*)
 *   2. CHAT READ  — claude.ai conversation API (session cookie)
 *
 * Env vars:
 *   CLAUDE_API_KEY      — sk-ant-api03-* (required for ask / run-prompt)
 *   CLAUDE_SESSION_KEY  — sessionKey cookie (required for get-chat / list-chats / fetch-rfc)
 *   CLAUDE_ORG_UUID     — org UUID (required for chat ops; auto-discovered if omitted)
 *
 * Commands:
 *   ask "<prompt>"                      Single-turn inference
 *   run-prompt <file.txt>               Inference with prompt from file
 *   list-chats [n]                      n most recent conversation titles + UUIDs (default 20)
 *   get-chat <uuid> [--all]             Print conversation; --all includes full text
 *   fetch-rfc <uuid> <search-term>      Extract RFC text from a conversation by search term
 *   search <query> [--limit n]          Full-text search across recent conversations
 *
 * Usage from bootstrap:
 *   CLAUDE_API_KEY=sk-ant-... node tools/claude-query.mjs ask "What is the RFC index?"
 *   CLAUDE_SESSION_KEY=sk-ant-sid01-... CLAUDE_ORG_UUID=<uuid> \
 *     node tools/claude-query.mjs fetch-rfc 77e39cc5-08e7-47c2-bd2c-76480316287f "RFC-BER-001"
 */

import https from 'https';

// ── HTTP helpers (no npm) ─────────────────────────────────────────────────────

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body: raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function apiGet(host, path, headers) {
  const res = await httpRequest({ hostname: host, path, method: 'GET', headers });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${path}\n${res.body.slice(0, 300)}`);
  return JSON.parse(res.body);
}

async function apiPost(host, path, headers, payload) {
  const body = JSON.stringify(payload);
  const res = await httpRequest({
    hostname: host, path, method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${path}\n${res.body.slice(0, 300)}`);
  }
  return JSON.parse(res.body);
}

// ── Anthropic Messages API ────────────────────────────────────────────────────

async function ask(prompt, opts = {}) {
  const apiKey = opts.apiKey || process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set');

  const payload = {
    model:      opts.model      || 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens  || 8192,
    messages:   [{ role: 'user', content: prompt }],
  };
  if (opts.system) payload.system = opts.system;

  const data = await apiPost('api.anthropic.com', '/v1/messages', {
    'x-api-key':         apiKey,
    'anthropic-version': '2023-06-01',
  }, payload);

  return data.content?.map(b => b.text || '').join('') || '';
}

// ── claude.ai conversation API ────────────────────────────────────────────────

function claudeHeaders(sessionKey, orgId) {
  return {
    'Cookie':                    `sessionKey=${sessionKey}; lastActiveOrg=${orgId}`,
    'User-Agent':                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept':                    'application/json',
    'anthropic-client-platform': 'web_claude_ai',
    'anthropic-device-id':       '4a7f9b2e-c831-4d5a-8e6f-1b3c9d2e4f70',
    'Referer':                   'https://claude.ai/',
    'Origin':                    'https://claude.ai',
  };
}

async function listConversations(sessionKey, orgId, limit = 20) {
  const headers = claudeHeaders(sessionKey, orgId);
  return apiGet('claude.ai', `/api/organizations/${orgId}/chat_conversations?limit=${limit}&offset=0`, headers);
}

async function getConversation(sessionKey, orgId, uuid) {
  const headers = claudeHeaders(sessionKey, orgId);
  return apiGet('claude.ai',
    `/api/organizations/${orgId}/chat_conversations/${uuid}?tree=True&rendering_mode=messages`,
    headers);
}

function extractText(conv) {
  const msgs = conv.chat_messages || [];
  return msgs.map(m => ({
    role: m.sender === 'human' ? 'user' : 'assistant',
    text: m.text || '',
    created_at: m.created_at,
  }));
}

// Discover org UUID automatically from the account API
async function discoverOrgId(sessionKey) {
  const res = await httpRequest({
    hostname: 'claude.ai',
    path: '/api/organizations',
    method: 'GET',
    headers: claudeHeaders(sessionKey, ''),
  });
  if (res.status !== 200) throw new Error(`Could not discover org UUID: HTTP ${res.status}`);
  const data = JSON.parse(res.body);
  const orgs = Array.isArray(data) ? data : (data.organizations || []);
  if (!orgs.length) throw new Error('No organizations found');
  return orgs[0].uuid || orgs[0].id;
}

// ── Commands ──────────────────────────────────────────────────────────────────

const HELP = `
claude-query.mjs — CAP-010

Commands:
  ask "<prompt>"                      Single-turn Anthropic API inference
  run-prompt <file>                   Inference from prompt file
  list-chats [n]                      List n recent conversations (default 20)
  get-chat <uuid> [--all]             Print conversation messages
  fetch-rfc <uuid> <term>             Extract RFC content from a conversation
  search <query> [--limit n]          Full-text search across conversations

Env:
  CLAUDE_API_KEY      sk-ant-api03-*  (inference commands)
  CLAUDE_SESSION_KEY  sessionKey cookie (chat commands)
  CLAUDE_ORG_UUID     org UUID (auto-discovered if omitted)
`.trim();

async function main() {
  const args = process.argv.slice(2);
  const cmd  = args[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  // ── ask ───────────────────────────────────────────────────────────────────
  if (cmd === 'ask') {
    const prompt = args.slice(1).join(' ');
    if (!prompt) { console.error('Usage: ask "<prompt>"'); process.exit(1); }
    const result = await ask(prompt);
    console.log(result);
    return;
  }

  // ── run-prompt ────────────────────────────────────────────────────────────
  if (cmd === 'run-prompt') {
    const { readFile } = await import('fs/promises');
    const file = args[1];
    if (!file) { console.error('Usage: run-prompt <file>'); process.exit(1); }
    const prompt = await readFile(file, 'utf8');
    const result = await ask(prompt.trim());
    console.log(result);
    return;
  }

  // ── Chat commands (need session key) ──────────────────────────────────────
  const sessionKey = process.env.CLAUDE_SESSION_KEY;
  if (!sessionKey) {
    console.error('[claude-query] CLAUDE_SESSION_KEY not set.');
    console.error('  Copy sessionKey from: DevTools -> Application -> Cookies -> claude.ai');
    process.exit(1);
  }

  let orgId = process.env.CLAUDE_ORG_UUID;
  if (!orgId) {
    process.stderr.write('[claude-query] Discovering org UUID...\n');
    orgId = await discoverOrgId(sessionKey);
    process.stderr.write(`[claude-query] Org UUID: ${orgId}\n`);
  }

  // ── list-chats ────────────────────────────────────────────────────────────
  if (cmd === 'list-chats') {
    const n = parseInt(args[1]) || 20;
    const convs = await listConversations(sessionKey, orgId, n);
    const list = Array.isArray(convs) ? convs : (convs.data || convs.conversations || []);
    for (const c of list) {
      const ts = new Date(c.updated_at).toLocaleString('en-US', { timeZone: 'America/Chicago' });
      console.log(`${c.uuid}  ${ts}  ${c.name || 'Untitled'}`);
    }
    return;
  }

  // ── get-chat ──────────────────────────────────────────────────────────────
  if (cmd === 'get-chat') {
    const uuid   = args[1];
    const showAll = args.includes('--all');
    if (!uuid) { console.error('Usage: get-chat <uuid> [--all]'); process.exit(1); }
    const conv = await getConversation(sessionKey, orgId, uuid);
    const msgs = extractText(conv);
    console.log(`Title: ${conv.name || 'Untitled'}`);
    console.log(`Messages: ${msgs.length}\n`);
    for (const m of msgs) {
      const prefix = m.role === 'user' ? 'USER:' : 'ASST:';
      const text   = showAll ? m.text : m.text.slice(0, 400) + (m.text.length > 400 ? '...' : '');
      console.log(`${prefix} ${text}\n`);
    }
    return;
  }

  // ── fetch-rfc ─────────────────────────────────────────────────────────────
  if (cmd === 'fetch-rfc') {
    const uuid = args[1];
    const term = args[2];
    if (!uuid || !term) {
      console.error('Usage: fetch-rfc <conversation-uuid> <search-term>');
      process.exit(1);
    }
    const conv = await getConversation(sessionKey, orgId, uuid);
    const msgs = extractText(conv);
    const termLc = term.toLowerCase();

    // Find the longest assistant message that contains the term
    const matches = msgs
      .filter(m => m.role === 'assistant' && m.text.toLowerCase().includes(termLc))
      .sort((a, b) => b.text.length - a.text.length);

    if (!matches.length) {
      console.error(`[fetch-rfc] Term "${term}" not found in conversation ${uuid}`);
      process.exit(1);
    }

    // Try to extract just the RFC block (from the first occurrence to end)
    const text   = matches[0].text;
    const startI = text.toLowerCase().indexOf(termLc);
    const rfcText = text.slice(startI);

    console.log(rfcText);
    return;
  }

  // ── search ────────────────────────────────────────────────────────────────
  if (cmd === 'search') {
    const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    const limit = parseInt(args[args.indexOf('--limit') + 1]) || 10;
    if (!query) { console.error('Usage: search <query> [--limit n]'); process.exit(1); }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    process.stderr.write(`[search] Scanning up to ${limit * 5} conversations for: "${query}"\n`);

    const convs = await listConversations(sessionKey, orgId, Math.min(limit * 5, 100));
    const list  = Array.isArray(convs) ? convs : (convs.data || convs.conversations || []);

    const results = [];
    for (const meta of list) {
      if (results.length >= limit) break;
      let conv;
      try { conv = await getConversation(sessionKey, orgId, meta.uuid); }
      catch { continue; }

      const msgs = extractText(conv);
      const fullText = msgs.map(m => m.text).join('\n').toLowerCase();
      const hits = terms.filter(t => fullText.includes(t)).length;
      if (hits === terms.length) {
        const i = fullText.indexOf(terms[0]);
        const snippet = fullText.slice(Math.max(0, i - 50), i + 150).replace(/\n+/g, ' ');
        results.push({ uuid: meta.uuid, title: meta.name || 'Untitled', snippet });
      }
      // Courtesy pause every 10 fetches
      if (list.indexOf(meta) % 10 === 9) await sleep(300);
    }

    if (!results.length) {
      console.log('[search] No results found.');
    } else {
      for (const r of results) {
        console.log(`\nhttps://claude.ai/chat/${r.uuid}`);
        console.log(`  ${r.title}`);
        console.log(`  ...${r.snippet}...`);
      }
    }
    return;
  }

  console.error(`Unknown command: ${cmd}\n`);
  console.log(HELP);
  process.exit(1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error('[claude-query] Error:', e.message); process.exit(1); });
