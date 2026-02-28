/**
 * claude-ai-client.mjs
 * Real claude.ai API client for bootstrap-stage2.
 *
 * Replaces the hobbled internal conversation_search / recent_chats tools
 * with direct access to the claude.ai REST API -- full message content,
 * not snippets.
 *
 * Required env vars:
 *   CLAUDE_SESSION_KEY  -- sessionKey cookie from browser DevTools
 *   CLAUDE_ORG_ID       -- org UUID (from any API URL: /organizations/{UUID}/...)
 *
 * Optional:
 *   CLAUDE_DEVICE_ID    -- anthropic-device-id header (any UUID, stable per session)
 *
 * To get your sessionKey:
 *   1. Open https://claude.ai in Chrome
 *   2. DevTools -> Application -> Cookies -> claude.ai
 *   3. Copy the sessionKey value (sk-ant-sid01-...)
 *
 * To get your org ID:
 *   1. DevTools -> Network -> any /api/organizations/ request
 *   2. Copy the UUID from the URL path
 *
 * NOTE: sessionKey expires. When it does, re-copy from browser and update env.
 */

const CLAUDE_BASE = 'https://claude.ai';

// Stable device ID -- use env or generate a consistent fallback
const DEVICE_ID = process.env.CLAUDE_DEVICE_ID
  || '4a7f9b2e-c831-4d5a-8e6f-1b3c9d2e4f70';

function makeHeaders(sessionKey, orgId) {
  return {
    'Cookie':                       `sessionKey=${sessionKey}; lastActiveOrg=${orgId}`,
    'User-Agent':                   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept':                       'application/json',
    'Accept-Language':              'en-US,en;q=0.9',
    'anthropic-client-platform':    'web_claude_ai',
    'anthropic-device-id':          DEVICE_ID,
    'Referer':                      'https://claude.ai/',
    'Origin':                       'https://claude.ai',
    'Sec-Fetch-Dest':               'empty',
    'Sec-Fetch-Mode':               'cors',
    'Sec-Fetch-Site':               'same-origin',
  };
}

// ── ClaudeAIClient ────────────────────────────────────────────────────────────
export class ClaudeAIClient {
  constructor(opts = {}) {
    this.sessionKey = opts.sessionKey || process.env.CLAUDE_SESSION_KEY;
    this.orgId      = opts.orgId      || process.env.CLAUDE_ORG_ID;

    if (!this.sessionKey) throw new Error(
      'ClaudeAIClient: CLAUDE_SESSION_KEY not set. ' +
      'Copy sessionKey cookie from DevTools -> Application -> Cookies -> claude.ai'
    );
    if (!this.orgId) throw new Error(
      'ClaudeAIClient: CLAUDE_ORG_ID not set. ' +
      'Copy org UUID from any /api/organizations/{UUID}/ request in DevTools Network tab'
    );

    this.headers = makeHeaders(this.sessionKey, this.orgId);
  }

  async _get(path) {
    const url = `${CLAUDE_BASE}${path}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`claude.ai API ${res.status}: ${path}\n${body.slice(0, 200)}`);
    }
    return res.json();
  }

  // ── List conversations ──────────────────────────────────────────────────────
  // Returns array of conversation metadata (no message content)
  async listConversations({ limit = 100, offset = 0 } = {}) {
    const data = await this._get(
      `/api/organizations/${this.orgId}/chat_conversations?limit=${limit}&offset=${offset}`
    );
    // API returns array directly or { data: [...] }
    return Array.isArray(data) ? data : (data.data || data.conversations || []);
  }

  // ── Get all conversations (paginated) ───────────────────────────────────────
  async *allConversations({ batchSize = 100 } = {}) {
    let offset = 0;
    while (true) {
      const batch = await this.listConversations({ limit: batchSize, offset });
      if (!batch.length) break;
      for (const c of batch) yield c;
      if (batch.length < batchSize) break;
      offset += batch.length;
    }
  }

  // ── Get full conversation with all messages ─────────────────────────────────
  async getConversation(uuid) {
    return this._get(
      `/api/organizations/${this.orgId}/chat_conversations/${uuid}` +
      `?tree=True&rendering_mode=messages`
    );
  }

  // ── Extract clean messages from conversation ────────────────────────────────
  // Captures text content, inline artifacts (code blocks), and file attachments.
  extractMessages(conversation) {
    const msgs = conversation.chat_messages || [];
    return msgs.map(m => ({
      role:        m.sender === 'human' ? 'user' : 'assistant',
      text:        m.text || '',
      created_at:  m.created_at,
      uuid:        m.uuid,
      // Inline artifacts (application/vnd.ant.code etc.) embedded in assistant messages
      artifacts:   (m.content || [])
                     .filter(b => b.type === 'tool_result' || (b.artifact?.type))
                     .map(b => b.artifact).filter(Boolean)
                   .concat(m.attachments?.filter(a => a.file_type === 'application/vnd.ant.code' ||
                                                       a.file_type?.startsWith('application/vnd.ant')) || []),
      // Uploaded file attachments (non-artifact)
      files:       (m.attachments || []).filter(a => !a.file_type?.startsWith('application/vnd.ant')),
    }));
  }

  // ── Recent conversations (n most recent, with metadata only) ───────────────
  async recentConversations(n = 20) {
    const results = [];
    for await (const c of this.allConversations()) {
      results.push(c);
      if (results.length >= n) break;
    }
    return results;
  }

  // ── Full-text search across recent conversations ────────────────────────────
  // Fetches up to `scanLimit` conversations and searches message content.
  // More thorough than the internal tool, which only returns snippets.
  async search(query, { scanLimit = 50, maxResults = 10 } = {}) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results = [];
    let scanned = 0;

    for await (const meta of this.allConversations()) {
      if (scanned >= scanLimit) break;
      scanned++;

      // Quick title check first (no full fetch needed)
      const titleMatch = terms.every(t => (meta.name || '').toLowerCase().includes(t));

      let conv;
      try {
        conv = await this.getConversation(meta.uuid);
      } catch { continue; }

      const messages = this.extractMessages(conv);
      const fullText = messages.map(m => m.text).join('\n').toLowerCase();
      const score = terms.filter(t => fullText.includes(t)).length;

      if (score === terms.length || titleMatch) {
        results.push({
          uuid:       meta.uuid,
          url:        `https://claude.ai/chat/${meta.uuid}`,
          title:      meta.name || 'Untitled',
          updated_at: meta.updated_at,
          score,
          messages,   // full messages, not snippets
          snippet:    this._snippet(fullText, terms),
        });

        if (results.length >= maxResults) break;
      }

      // Rate limit courtesy pause every 10 fetches
      if (scanned % 10 === 0) await sleep(300);
    }

    return results.sort((a, b) => b.score - a.score);
  }

  // ── Get recent conversations with full content ──────────────────────────────
  async recentFull(n = 5) {
    const recent = await this.recentConversations(n);
    const full = [];
    for (const meta of recent) {
      try {
        const conv = await this.getConversation(meta.uuid);
        full.push({
          uuid:       meta.uuid,
          url:        `https://claude.ai/chat/${meta.uuid}`,
          title:      meta.name || 'Untitled',
          updated_at: meta.updated_at,
          messages:   this.extractMessages(conv),
        });
      } catch { /* skip failed fetches */ }
      await sleep(100);
    }
    return full;
  }

  // ── Wiggle: list files attached to a conversation ─────────────────────────
  // Returns array of { name, size, type } for uploaded file attachments.
  // These are discrete files (PDFs, markdown, code) uploaded by the user,
  // distinct from inline artifacts embedded in message content.
  async listFiles(uuid) {
    const path = `/api/organizations/${this.orgId}/conversations/${uuid}/wiggle/list-files?prefix=`;
    try {
      const data = await this._get(path);
      return Array.isArray(data) ? data : (data.files || []);
    } catch (e) {
      // 404 = no files attached to this conversation
      if (e.message.includes('404')) return [];
      throw e;
    }
  }

  // ── Wiggle: download a specific attached file ───────────────────────────────
  // Returns the raw file content as a string (text files) or base64 (binary).
  // Caller should check content-type to decide how to handle.
  async downloadFile(uuid, filename) {
    const encoded = encodeURIComponent(filename);
    const path = `/api/organizations/${this.orgId}/conversations/${uuid}/wiggle/download?file=${encoded}`;
    const url = `${CLAUDE_BASE}${path}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`claude.ai wiggle ${res.status}: ${filename}\n${body.slice(0, 200)}`);
    }
    const contentType = res.headers?.get?.('content-type') || '';
    const isBinary = !contentType.startsWith('text/') &&
                     !contentType.includes('json') &&
                     !contentType.includes('javascript') &&
                     !contentType.includes('xml');
    if (isBinary) {
      // Return base64 for binary files (PDFs, images, etc.)
      const buf = await res.arrayBuffer();
      return {
        filename,
        contentType,
        encoding: 'base64',
        content: Buffer.from(buf).toString('base64'),
      };
    }
    return {
      filename,
      contentType,
      encoding: 'utf8',
      content: await res.text(),
    };
  }

  // ── Wiggle: get all files for a conversation with content ───────────────────
  async getAllFiles(uuid) {
    const files = await this.listFiles(uuid);
    const results = [];
    for (const f of files) {
      try {
        const dl = await this.downloadFile(uuid, f.name);
        results.push({ ...f, ...dl });
        await sleep(100);
      } catch (e) {
        results.push({ ...f, error: e.message });
      }
    }
    return results;
  }

  // ── Snippet helper ──────────────────────────────────────────────────────────
  _snippet(text, terms, window = 150) {
    for (const term of terms) {
      const i = text.indexOf(term);
      if (i !== -1) {
        const start = Math.max(0, i - 60);
        const end   = Math.min(text.length, i + window);
        return '...' + text.slice(start, end).replace(/\n+/g, ' ') + '...';
      }
    }
    return text.slice(0, window) + '...';
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Bootstrap integration helpers ─────────────────────────────────────────────
// Drop-in replacements for the internal conversation_search / recent_chats tools.
// Wire these into stage2 context map loading.

export function makeBootstrapTools(client) {
  return {
    // Direct wiggle access: list and download files from a conversation
    async getConversationFiles(uuid) {
      return client.getAllFiles(uuid);
    },

    // Replacement for conversation_search tool
    async conversationSearch(query, maxResults = 5) {
      try {
        const results = await client.search(query, { scanLimit: 40, maxResults });
        return results.map(r => ({
          uri:        r.uuid,
          url:        r.url,
          title:      r.title,
          updated_at: r.updated_at,
          // Full messages -- not snippets
          messages:   r.messages,
          snippet:    r.snippet,
        }));
      } catch (e) {
        return [{ error: e.message }];
      }
    },

    // Replacement for recent_chats tool
    async recentChats(n = 10, { before, after } = {}) {
      try {
        let convs = await client.recentConversations(Math.min(n * 3, 60));

        if (after)  convs = convs.filter(c => new Date(c.updated_at) > new Date(after));
        if (before) convs = convs.filter(c => new Date(c.updated_at) < new Date(before));

        convs = convs.slice(0, n);

        // Return metadata only (full fetch is expensive -- caller can call getConversation)
        return convs.map(c => ({
          uri:        c.uuid,
          url:        `https://claude.ai/chat/${c.uuid}`,
          title:      c.name || 'Untitled',
          updated_at: c.updated_at,
        }));
      } catch (e) {
        return [{ error: e.message }];
      }
    },
  };
}

// ── CLI smoke test ────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('claude-ai-client.mjs')) {
  const cmd  = process.argv[2];
  const arg1 = process.argv[3];

  let client;
  try {
    client = new ClaudeAIClient();
  } catch (e) {
    console.error('[claude-ai-client]', e.message);
    process.exit(1);
  }

  if (!cmd || cmd === 'recent') {
    const n = parseInt(arg1) || 5;
    console.log(`[claude-ai-client] ${n} most recent conversations:\n`);
    const convs = await client.recentConversations(n);
    for (const c of convs) {
      console.log(`  ${c.uuid}  ${new Date(c.updated_at).toLocaleString()}  ${c.name || 'Untitled'}`);
    }

  } else if (cmd === 'search') {
    if (!arg1) { console.error('Usage: search <query>'); process.exit(1); }
    console.log(`[claude-ai-client] Searching: "${arg1}"\n`);
    const results = await client.search(arg1, { scanLimit: 30, maxResults: 5 });
    for (const r of results) {
      console.log(`  ${r.url}`);
      console.log(`  ${r.title} (${new Date(r.updated_at).toLocaleString()})`);
      console.log(`  ${r.snippet}\n`);
    }

  } else if (cmd === 'get') {
    if (!arg1) { console.error('Usage: get <uuid>'); process.exit(1); }
    const conv = await client.getConversation(arg1);
    const msgs = client.extractMessages(conv);
    console.log(`Title: ${conv.name}\nMessages: ${msgs.length}\n`);
    for (const m of msgs) {
      const prefix = m.role === 'user' ? 'H:' : 'A:';
      console.log(`${prefix} ${m.text.slice(0, 200)}${m.text.length > 200 ? '...' : ''}\n`);
    }

  } else {
    console.log('Usage:');
    console.log('  node claude-ai-client.mjs recent [n]');
    console.log('  node claude-ai-client.mjs search <query>');
    console.log('  node claude-ai-client.mjs get <uuid>');
  }
}
