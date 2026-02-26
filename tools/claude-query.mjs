#!/usr/bin/env node
/**
 * claude-query.mjs — Direct Claude API query tool for bootstrap/session use.
 *
 * Two backends, zero npm dependencies (Node 18+ built-in fetch only):
 *
 *   APIBackend  — api.anthropic.com, API key auth.
 *                 Use for inference: analysis, reconstruction, generation.
 *
 *   WebBackend  — claude.ai web API, cookie auth.
 *                 Use for conversation retrieval: full message history by UUID.
 *
 * Usage (API backend):
 *   CLAUDE_API_KEY=sk-ant-... node claude-query.mjs ask "Summarize RFC-000"
 *   CLAUDE_API_KEY=sk-ant-... node claude-query.mjs ask --system "You are..." "Prompt"
 *
 * Usage (Web backend — conversation retrieval):
 *   CLAUDE_SESSION_KEY=sk-ant-sid01-... \
 *   CLAUDE_ORG_UUID=bfe5a4ce-... \
 *   node claude-query.mjs get-chat <conversation-uuid>
 *
 *   CLAUDE_SESSION_KEY=... CLAUDE_ORG_UUID=... \
 *   node claude-query.mjs list-chats [--limit 20]
 *
 * Credentials (checked in order):
 *   1. CLI flags: --api-key, --session-key, --org-uuid, --cookie
 *   2. Environment: CLAUDE_API_KEY, CLAUDE_SESSION_KEY, CLAUDE_ORG_UUID, CLAUDE_COOKIE
 *   3. Memory item 2 (API key) — must be supplied externally; not auto-read.
 *
 * Output: JSON to stdout. Errors to stderr. Exit 0 on success, 1 on error.
 *
 * Location: bclark00/bootstrap-utils/tools/claude-query.mjs
 * CAP: CAP-010
 */

// ── Config ─────────────────────────────────────────────────────────────────

const DEFAULT_MODEL    = 'claude-opus-4-6';
const DEFAULT_MAX_TOK  = 8096;
const CLAUDE_AI_BASE   = 'https://claude.ai';
const ANTHROPIC_API    = 'https://api.anthropic.com';
const ANTHROPIC_VER    = '2023-06-01';
const DEFAULT_UA       =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      flags[key] = args[++i] ?? true;
    } else {
      positional.push(args[i]);
    }
  }
  return { command: positional[0], rest: positional.slice(1), flags };
}

// ── Credential resolution ──────────────────────────────────────────────────

function cred(flag, envVar, flags) {
  return flags[flag] ?? process.env[envVar] ?? null;
}

// ── API Backend ────────────────────────────────────────────────────────────

async function apiAsk({ apiKey, prompt, system, model, maxTokens, stream }) {
  const body = {
    model:      model      ?? DEFAULT_MODEL,
    max_tokens: maxTokens  ?? DEFAULT_MAX_TOK,
    messages:   [{ role: 'user', content: prompt }],
    stream:     stream     ?? false,
  };
  if (system) body.system = system;

  const res = await fetch(`${ANTHROPIC_API}/v1/messages`, {
    method:  'POST',
    headers: {
      'content-type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': ANTHROPIC_VER,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }

  if (stream) {
    // Stream to stdout, return full text
    let full = '';
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        const json = line.slice(6).trim();
        if (json === '[DONE]') break;
        try {
          const ev = JSON.parse(json);
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            process.stdout.write(ev.delta.text);
            full += ev.delta.text;
          }
        } catch { /* skip malformed */ }
      }
    }
    process.stdout.write('\n');
    return full;
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? JSON.stringify(data);
}

// ── Web Backend helpers ────────────────────────────────────────────────────

function buildCookieHeader({ sessionKey, deviceId, orgUuid, cfClearance, cfBm, rawCookie }) {
  if (rawCookie) return rawCookie;
  const parts = [];
  const add = (k, v) => { if (v) parts.push(`${k}=${v}`); };
  add('anthropic-device-id', deviceId);
  add('sessionKey',          sessionKey);
  add('lastActiveOrg',       orgUuid);
  add('cf_clearance',        cfClearance);
  add('__cf_bm',             cfBm);
  return parts.join('; ');
}

function webHeaders(cookieStr, deviceId) {
  return {
    'accept':                     'application/json, */*',
    'anthropic-client-platform':  'web_claude_ai',
    'anthropic-client-version':   '1.0.0',
    'anthropic-client-sha':       'unknown',
    'anthropic-version':          ANTHROPIC_VER,
    'content-type':               'application/json',
    'user-agent':                 DEFAULT_UA,
    'sec-fetch-dest':             'empty',
    'sec-fetch-mode':             'cors',
    'sec-fetch-site':             'same-origin',
    ...(cookieStr ? { cookie: cookieStr } : {}),
    ...(deviceId  ? { 'anthropic-device-id': deviceId } : {}),
  };
}

async function webGet(path, creds) {
  const cookieStr = buildCookieHeader(creds);
  const res = await fetch(`${CLAUDE_AI_BASE}${path}`, {
    headers: webHeaders(cookieStr, creds.deviceId),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (body.includes('Just a moment') || body.includes('cf-')) {
      throw new Error(`Cloudflare blocked (${res.status}). Need fresh cf_clearance cookie.`);
    }
    throw new Error(`Web API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Commands ───────────────────────────────────────────────────────────────

async function cmdAsk(flags, rest) {
  const apiKey = cred('api-key', 'CLAUDE_API_KEY', flags);
  if (!apiKey) throw new Error('No API key. Set CLAUDE_API_KEY or --api-key');
  const prompt = rest.join(' ');
  if (!prompt) throw new Error('Usage: ask [--system "..."] [--model "..."] <prompt>');
  const result = await apiAsk({
    apiKey,
    prompt,
    system:    flags.system    ?? null,
    model:     flags.model     ?? null,
    maxTokens: flags['max-tokens'] ? Number(flags['max-tokens']) : null,
    stream:    flags.stream !== undefined,
  });
  if (!flags.stream) process.stdout.write(result + '\n');
}

async function cmdListChats(flags, rest) {
  const orgUuid    = cred('org-uuid',     'CLAUDE_ORG_UUID',     flags);
  const sessionKey = cred('session-key',  'CLAUDE_SESSION_KEY',  flags);
  const rawCookie  = cred('cookie',       'CLAUDE_COOKIE',       flags);
  if (!orgUuid) throw new Error('No org UUID. Set CLAUDE_ORG_UUID or --org-uuid');
  if (!sessionKey && !rawCookie) throw new Error('No session key. Set CLAUDE_SESSION_KEY or --session-key');
  const limit  = flags.limit ? Number(flags.limit) : 30;
  const offset = flags.offset ? Number(flags.offset) : 0;
  const data = await webGet(
    `/api/organizations/${orgUuid}/chat_conversations?limit=${limit}&offset=${offset}`,
    { sessionKey, rawCookie, orgUuid }
  );
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

async function cmdGetChat(flags, rest) {
  const chatUuid   = rest[0];
  const orgUuid    = cred('org-uuid',    'CLAUDE_ORG_UUID',    flags);
  const sessionKey = cred('session-key', 'CLAUDE_SESSION_KEY', flags);
  const rawCookie  = cred('cookie',      'CLAUDE_COOKIE',      flags);
  if (!chatUuid)   throw new Error('Usage: get-chat <conversation-uuid>');
  if (!orgUuid)    throw new Error('No org UUID. Set CLAUDE_ORG_UUID or --org-uuid');
  if (!sessionKey && !rawCookie) throw new Error('No session key. Set CLAUDE_SESSION_KEY or --session-key');
  const data = await webGet(
    `/api/organizations/${orgUuid}/chat_conversations/${chatUuid}`,
    { sessionKey, rawCookie, orgUuid }
  );
  // Pretty print with message count summary
  const msgs = data.chat_messages ?? [];
  if (flags.messages) {
    // --messages: print message texts only
    for (const m of msgs) {
      process.stdout.write(`\n=== [${m.sender}] ===\n${m.text ?? m.content ?? ''}\n`);
    }
  } else if (flags.raw) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    // Summary + first/last messages
    const summary = {
      uuid:          data.uuid,
      name:          data.name,
      created_at:    data.created_at,
      updated_at:    data.updated_at,
      message_count: msgs.length,
      first_message: msgs[0]  ? { sender: msgs[0].sender,  text: (msgs[0].text  ?? '').slice(0, 200) } : null,
      last_message:  msgs.at(-1) ? { sender: msgs.at(-1).sender, text: (msgs.at(-1).text ?? '').slice(0, 200) } : null,
    };
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    if (flags.all) {
      for (const m of msgs) {
        process.stdout.write(`\n--- [${m.sender}] ${m.created_at} ---\n${m.text ?? ''}\n`);
      }
    }
  }
}

function cmdHelp() {
  process.stdout.write(`
claude-query.mjs — Direct Claude API/Web query tool (CAP-010)

COMMANDS:
  ask [--system "..."] [--model "..."] [--stream] <prompt>
      Query Claude API (api.anthropic.com). Requires CLAUDE_API_KEY.

  list-chats [--limit N] [--offset N]
      List conversations from claude.ai. Requires CLAUDE_SESSION_KEY + CLAUDE_ORG_UUID.

  get-chat <uuid> [--all] [--messages] [--raw]
      Fetch full conversation from claude.ai.
      --all: print all messages after summary
      --messages: print messages only (no summary)
      --raw: raw JSON output
      Requires CLAUDE_SESSION_KEY + CLAUDE_ORG_UUID.

CREDENTIALS (env vars):
  CLAUDE_API_KEY        sk-ant-api03-...  (for 'ask')
  CLAUDE_SESSION_KEY    sk-ant-sid01-...  (for web commands)
  CLAUDE_ORG_UUID       bfe5a4ce-...      (for web commands)
  CLAUDE_COOKIE         raw cookie string (alternative to SESSION_KEY)

NOTE: Web commands require valid Cloudflare cookies (cf_clearance).
      If blocked, provide fresh cookies via CLAUDE_COOKIE.
      Use claude-cf-solver.ts (in genesis-docs-canon/reference-implementations)
      to obtain fresh CF cookies via Playwright.
`);
}

// ── Main ───────────────────────────────────────────────────────────────────

const { command, rest, flags } = parseArgs(process.argv);

try {
  switch (command) {
    case 'ask':        await cmdAsk(flags, rest);       break;
    case 'list-chats': await cmdListChats(flags, rest); break;
    case 'get-chat':   await cmdGetChat(flags, rest);   break;
    case 'help':
    case '--help':
    case undefined:    cmdHelp();                       break;
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      cmdHelp();
      process.exit(1);
  }
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}
