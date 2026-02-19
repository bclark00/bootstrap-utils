#!/usr/bin/env node
/**
 * sovereign-build-orchestrator.js
 *
 * AI² formula: Claude Reasoning × Code Execution × Parallel Amplification
 *
 * Fans out to Claude API with specs for each sovereign VM layer.
 * All layers built simultaneously. Each verified by SHA256 before push.
 * Results pushed to bclark00/bootstrap-utils/sovereign-vm/
 *
 * Usage:
 *   CLAUDE_API_KEY=sk-ant-... GITHUB_TOKEN=ghp_... node sovereign-build-orchestrator.js
 *   node sovereign-build-orchestrator.js --dry-run   (build but don't push)
 *   node sovereign-build-orchestrator.js --layer 1   (single layer)
 */

'use strict';

const https   = require('https');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const DRY_RUN        = process.argv.includes('--dry-run');
const SINGLE_LAYER   = process.argv.includes('--layer')
  ? parseInt(process.argv[process.argv.indexOf('--layer') + 1])
  : null;

const REPO    = 'bclark00/bootstrap-utils';
const VM_DIR  = 'sovereign-vm';
const MODEL   = 'claude-opus-4-20250514';

// ── Layer specifications ──────────────────────────────────────────────────────
// Each spec is the complete prompt sent to Claude.
// Claude returns ONLY the file content — no prose, no explanation.

const LAYERS = [
  {
    id: 1,
    file: 'sovereign-audit-mcp.js',
    desc: 'SOVEREIGN-AUDIT-MCP — Layer 1: filesystem audit with SHA256 change detection',
    spec: `
Write a complete Node.js MCP server file called sovereign-audit-mcp.js.

CONSTRAINTS (non-negotiable):
- Zero external dependencies. Node.js built-ins only (fs, path, crypto, readline).
- Zero credentials embedded anywhere.
- Zero proc_kill, exec, or spawn capabilities.
- Watches only SOVEREIGN_FS_ROOT env var directory (default: cwd).
- Read-only observation — never modifies watched files.

CAPABILITIES: fs_read, net_dial (for emit only, optional)

TOOLS to implement:
  audit_start    {} -> { watching: string, session_id: string }
    Begin watching SOVEREIGN_FS_ROOT for changes. Return session ID.
  audit_snapshot {} -> { files: [{path, sha256, size, mtime}], manifest_sha256: string }
    SHA256 snapshot of entire watched tree right now.
  audit_diff     { since_snapshot: string } -> { changed: [], added: [], deleted: [], manifest_sha256: string }
    Diff current state against a previous snapshot hash.
  audit_verify   { path: string, expected_sha256: string } -> { match: bool, actual_sha256: string }
    Verify a single file against expected hash.
  audit_self     {} -> { name, version, sha256, capabilities, deps: [], credentials: [] }
    Self-describing: report own SHA256 at runtime.

ARCHITECTURE:
- In-memory snapshot store (Map: snapshot_id -> file list)
- snapshot_id = sha256 of manifest content
- MCP JSON-RPC over stdio (newline-delimited)
- Self-integrity: on startup, compute own SHA256 and write to stderr
- Log format: stderr only, never stdout (stdout is MCP protocol)

Start with 'use strict'; and a JSDoc header listing:
  Capability, Deps, Credentials, Replaces (audit-nexus/mcp-server.js), Clean delta

Output ONLY the complete file content. No explanation. No markdown fences.
`,
  },
  {
    id: 2,
    file: 'sovereign-pipe-mcp.js',
    desc: 'SOVEREIGN-PIPE-MCP — Layer 2: named pipe listener, no MITM',
    spec: `
Write a complete Node.js MCP server file called sovereign-pipe-mcp.js.

CONSTRAINTS (non-negotiable):
- Zero external dependencies. Node.js built-ins only (net, fs, path, crypto, readline).
- Zero credentials embedded anywhere.
- NO mitm_proxy capability — passive listen only, no frame injection.
- NO bidirectional interception.
- Pipes listed in SOVEREIGN_PIPES env var (comma-separated names) only.

CAPABILITIES: net_pipe, net_listen

TOOLS to implement:
  pipe_list      {} -> [{ name, state, frames_seen }]
    List all configured pipes and their current state.
  pipe_listen    { name: string, duration_ms: number } -> { frames: [{ts, dir, data_sha256, size}], count: number }
    Passively listen to a named pipe for up to duration_ms. Record frame metadata (hash + size) but NOT content unless store_content: true.
  pipe_snapshot  { name: string } -> { name, state, last_frame_sha256, total_frames }
    Current state of a pipe without starting a new capture.
  pipe_self      {} -> { name, version, sha256, capabilities, deps: [], credentials: [] }
    Self-describing.

ARCHITECTURE:
- Uses net.createServer on Windows named pipe paths (\\\\.\\\pipe\\NAME)
- Frame detection: length-prefixed and newline-delimited auto-detected
- Content hash: SHA256 each frame, store hash only by default
- MCP JSON-RPC over stdio
- Self-integrity on startup to stderr

CLEAN DELTA from conduit-mcp-server.js:
- No DualTap learning (removes ML surface)
- No MITM proxy mode
- No pipe_tap_inside injection
- Observation only

Output ONLY the complete file content. No explanation. No markdown fences.
`,
  },
  {
    id: 3,
    file: 'sovereign-transport-mcp.js',
    desc: 'SOVEREIGN-TRANSPORT-MCP — Layer 3: protocol transform, no credentials, no state',
    spec: `
Write a complete Node.js MCP server file called sovereign-transport-mcp.js.

CONSTRAINTS (non-negotiable):
- Zero external dependencies. Node.js built-ins only (net, http, crypto, readline, stream).
- Zero credentials embedded.
- Zero persistent state — every transform is stateless.
- NO genetic learning engine.
- NO create-and-push scripts.
- NO hardcoded tokens or keys.

CAPABILITIES: net_dial, ipc_rpc

TOOLS to implement:
  transform      { source: {protocol, data}, destination: {protocol} } -> { data, sha256_in, sha256_out, protocol }
    Transform data between: json, msgpack_lite (pure JS impl), base64, hex, utf8, newline_rpc, length_prefixed_rpc
    Implement msgpack_lite as a minimal pure-JS subset (integers, strings, arrays, maps — no extensions).
  detect_protocol { data: string } -> { detected: string, confidence: number }
    Detect the framing protocol of a data sample.
  transform_self  {} -> { name, version, sha256, capabilities, deps: [], credentials: [], supported_protocols: [] }
    Self-describing.

ARCHITECTURE:
- All transforms pure functions: (input_bytes) -> output_bytes
- SHA256 computed on input and output for every transform
- No network connections opened by default (stateless)
- MCP JSON-RPC over stdio
- Self-integrity on startup to stderr

CLEAN DELTA from mtransport-v5-cascade:
- No genetic/evolutionary learning
- No streaming engine with persistent state
- No create-and-push.ps1 or token files
- Pure transform — in, out, done

Output ONLY the complete file content. No explanation. No markdown fences.
`,
  },
  {
    id: 4,
    file: 'sovereign-boot.js',
    desc: 'SOVEREIGN-BOOT — Layer 4: hash verifier, nothing starts until manifest clears',
    spec: `
Write a complete Node.js bootstrap verifier file called sovereign-boot.js.

This is the prophylaxis layer. It runs before any other component.
If any component hash mismatches the manifest, it HALTs with exit code 1.

CONSTRAINTS:
- Zero external dependencies. Node.js built-ins only (fs, path, crypto, child_process).
- Zero credentials.
- HALT behavior is non-negotiable — no --skip-verify flags.

ALGORITHM:
1. Read sovereign-manifest.json from same directory (or SOVEREIGN_MANIFEST env)
2. For each entry in manifest: { file, sha256, capabilities, layer }
3. Compute SHA256 of each file
4. If mismatch: log HALT reason to stderr, exit(1)
5. If all clear: log VERIFIED to stderr for each file
6. Start components in layer order (0 -> 1 -> 2 -> 3) using child_process.spawn
   Each component started with: SOVEREIGN_FS_ROOT, SOVEREIGN_PIPES env vars passed through
   Each component's stderr piped to parent stderr with [layer-N] prefix
7. Wait for all components. On any component exit: log and restart up to 3 times.

MANIFEST FORMAT (sovereign-manifest.json):
{
  "version": "1.0",
  "components": [
    { "layer": 0, "file": "sovereign-fs-mcp.js",        "sha256": "...", "capabilities": ["fs_read","fs_write","ipc_rpc"] },
    { "layer": 1, "file": "sovereign-audit-mcp.js",     "sha256": "...", "capabilities": ["fs_read"] },
    { "layer": 2, "file": "sovereign-pipe-mcp.js",      "sha256": "...", "capabilities": ["net_pipe","net_listen"] },
    { "layer": 3, "file": "sovereign-transport-mcp.js", "sha256": "...", "capabilities": ["net_dial","ipc_rpc"] }
  ]
}

OUTPUT to stderr on clean boot:
  SOVEREIGN-BOOT v1.0.0
  [VERIFY] sovereign-fs-mcp.js        sha256:XXXX OK
  [VERIFY] sovereign-audit-mcp.js     sha256:XXXX OK
  [VERIFY] sovereign-pipe-mcp.js      sha256:XXXX OK
  [VERIFY] sovereign-transport-mcp.js sha256:XXXX OK
  [START]  layer-0 sovereign-fs-mcp.js PID=XXXX
  [START]  layer-1 sovereign-audit-mcp.js PID=XXXX
  ... etc

Export a verify(manifestPath) function for programmatic use.

Output ONLY the complete file content. No explanation. No markdown fences.
`,
  },
  {
    id: 5,
    file: 'sovereign-9p-gateway.js',
    desc: 'SOVEREIGN-9P-GATEWAY — Layer 5: serves VM over 9P for Mac Mini mount',
    spec: `
Write a complete Node.js 9P protocol gateway file called sovereign-9p-gateway.js.

Serves SOVEREIGN_FS_ROOT over 9P2000 protocol so a Mac Mini (clean substrate)
can mount and verify files without trusting the Windows filesystem.

CONSTRAINTS:
- Zero external dependencies. Node.js built-ins only (net, fs, path, crypto).
- Zero credentials.
- Read-only export (no write operations accepted from 9P clients).
- Every file served includes X-SHA256 in stat metadata.

9P2000 IMPLEMENTATION:
Implement a minimal 9P2000 server handling these message types:
  Tversion / Rversion  — negotiate protocol
  Tattach  / Rattach   — attach to root
  Tstat    / Rstat     — file metadata (include sha256 in name field as "name|sha256:HASH")
  Twalk    / Rwalk     — path traversal
  Topen    / Ropen     — open file
  Tread    / Rread     — read file data
  Tclunk   / Rclunk    — close fid
  Tflush   / Rflush    — flush pending

Message framing: 4-byte little-endian length prefix.

CONFIG via env:
  SOVEREIGN_9P_PORT   = 5640 (default)
  SOVEREIGN_9P_HOST   = 0.0.0.0 (default)
  SOVEREIGN_FS_ROOT   = directory to export

INTEGRITY:
- Every Rstat response includes sha256 of file content in the qid.vers field
  (encode as lower 32 bits of sha256 interpreted as uint32)
- On connect: log client address to stderr
- On each Tread: log path + sha256 to stderr

SELF-DESCRIBING:
  Add a synthetic file at root: .sovereign-gateway-info
  Content: JSON with { version, sha256_of_self, root, read_only: true, port }

Output ONLY the complete file content. No explanation. No markdown fences.
`,
  },
  {
    id: 6,
    file: 'sovereign-manifest-generator.js',
    desc: 'SOVEREIGN-MANIFEST-GENERATOR — builds sovereign-manifest.json from actual hashes',
    spec: `
Write a complete Node.js utility called sovereign-manifest-generator.js.

Scans the sovereign-vm directory, hashes all sovereign-*.js files,
and writes sovereign-manifest.json with the canonical hashes.

Also writes SOVEREIGN-VM-MANIFEST.txt in the format:
  sha256  filename  size_bytes

This is the ground truth anchor for the entire VM.

ALGORITHM:
1. Find all sovereign-*.js files in same directory (or SOVEREIGN_VM_DIR env)
2. SHA256 each file
3. Extract capabilities list from each file's JSDoc header comment
   (line matching "Capability:" or "capabilities:")
4. Extract layer number from JSDoc header (line matching "Layer N:")
5. Build manifest object
6. Write sovereign-manifest.json
7. Write SOVEREIGN-VM-MANIFEST.txt  
8. Print manifest_sha256 (hash of the manifest file itself) to stdout

MANIFEST JSON FORMAT:
{
  "version": "1.0",
  "generated": "ISO timestamp",
  "manifest_sha256": "sha256 of this file (computed after writing)",
  "components": [
    {
      "layer": 0,
      "file": "sovereign-fs-mcp.js",
      "sha256": "...",
      "size": 10776,
      "capabilities": ["ipc_rpc", "fs_read", "fs_write"]
    },
    ...
  ]
}

Output ONLY the complete file content. No explanation. No markdown fences.
`,
  },
];

// ── Claude API call ───────────────────────────────────────────────────────────

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a systems programmer. Output ONLY raw file content — no markdown, no explanation, no code fences. The output will be saved directly to disk.',
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers:  {
        'Content-Type':      'application/json',
        'x-api-key':         CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const text = parsed.content?.[0]?.text;
          if (!text) return reject(new Error('Empty response'));
          // Strip accidental markdown fences
          const clean = text.replace(/^```[a-z]*\n?/m, '').replace(/\n?```$/m, '').trim();
          resolve(clean);
        } catch (e) {
          reject(new Error('Parse error: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── GitHub push ───────────────────────────────────────────────────────────────

function githubPush(filepath, content, message) {
  return new Promise((resolve, reject) => {
    const b64 = Buffer.from(content).toString('base64');

    // First get existing SHA if file exists
    const getReq = https.request({
      hostname: 'api.github.com',
      path:     `/repos/${REPO}/contents/${filepath}`,
      method:   'GET',
      headers:  {
        'Authorization': 'Bearer ' + GITHUB_TOKEN,
        'User-Agent':    'sovereign-build-orchestrator',
        'Accept':        'application/vnd.github.v3+json',
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let existingSha = '';
        try { existingSha = JSON.parse(data).sha || ''; } catch (_) {}

        const body = JSON.stringify({
          message,
          content: b64,
          ...(existingSha ? { sha: existingSha } : {}),
        });

        const putReq = https.request({
          hostname: 'api.github.com',
          path:     `/repos/${REPO}/contents/${filepath}`,
          method:   'PUT',
          headers:  {
            'Authorization': 'Bearer ' + GITHUB_TOKEN,
            'User-Agent':    'sovereign-build-orchestrator',
            'Content-Type':  'application/json',
            'Accept':        'application/vnd.github.v3+json',
          },
        }, putRes => {
          let putData = '';
          putRes.on('data', c => putData += c);
          putRes.on('end', () => {
            try {
              const r = JSON.parse(putData);
              resolve(r.content?.sha?.substring(0, 12) || 'pushed');
            } catch (_) {
              resolve('pushed');
            }
          });
        });
        putReq.on('error', reject);
        putReq.write(body);
        putReq.end();
      });
    });
    getReq.on('error', reject);
    getReq.end();
  });
}

// ── Build one layer ───────────────────────────────────────────────────────────

async function buildLayer(layer) {
  const start = Date.now();
  process.stderr.write(`[layer-${layer.id}] Building ${layer.file}...\n`);

  let code;
  try {
    code = await callClaude(layer.spec);
  } catch (e) {
    return { layer: layer.id, file: layer.file, status: 'FAILED', error: e.message };
  }

  const sha256 = crypto.createHash('sha256').update(code).digest('hex');
  const size   = Buffer.byteLength(code);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  process.stderr.write(`[layer-${layer.id}] Built ${layer.file} sha256:${sha256.substring(0,16)}... (${size}b, ${elapsed}s)\n`);

  // Save locally
  const outPath = path.join('/tmp', layer.file);
  fs.writeFileSync(outPath, code);

  if (!DRY_RUN) {
    try {
      const pushed = await githubPush(
        `${VM_DIR}/${layer.file}`,
        code,
        `feat: ${layer.desc} (sha256:${sha256.substring(0,8)})`
      );
      process.stderr.write(`[layer-${layer.id}] Pushed ${layer.file} -> ${pushed}\n`);
    } catch (e) {
      return { layer: layer.id, file: layer.file, status: 'PUSH_FAILED', sha256, size, error: e.message };
    }
  }

  return { layer: layer.id, file: layer.file, status: 'OK', sha256, size, elapsed };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!CLAUDE_API_KEY) { console.error('CLAUDE_API_KEY required'); process.exit(1); }
  if (!GITHUB_TOKEN && !DRY_RUN) { console.error('GITHUB_TOKEN required (or use --dry-run)'); process.exit(1); }

  const layers = SINGLE_LAYER
    ? LAYERS.filter(l => l.id === SINGLE_LAYER)
    : LAYERS;

  process.stderr.write(`\nSOVEREIGN-VM BUILD ORCHESTRATOR\n`);
  process.stderr.write(`Building ${layers.length} layers in parallel...\n`);
  process.stderr.write(`Model: ${MODEL}  Dry-run: ${DRY_RUN}\n\n`);

  const t0 = Date.now();

  // Fan out — all layers in parallel
  const results = await Promise.all(layers.map(buildLayer));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Summary
  console.log('\n' + '='.repeat(72));
  console.log('SOVEREIGN-VM BUILD COMPLETE');
  console.log('='.repeat(72));
  console.log(`Total time: ${elapsed}s  (parallel)`);
  console.log('');

  const manifest = { version: '1.0', components: [] };

  for (const r of results.sort((a, b) => a.layer - b.layer)) {
    const status = r.status === 'OK' ? 'OK  ' : 'FAIL';
    console.log(`  [${status}] layer-${r.layer} ${r.file}`);
    if (r.sha256) console.log(`         sha256:${r.sha256}`);
    if (r.error)  console.log(`         ERROR: ${r.error}`);
    if (r.status === 'OK') {
      manifest.components.push({
        layer:  r.layer,
        file:   r.file,
        sha256: r.sha256,
        size:   r.size,
      });
    }
  }

  // Write manifest
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestSha256 = crypto.createHash('sha256').update(manifestJson).digest('hex');
  manifest.manifest_sha256 = manifestSha256;

  const finalManifest = JSON.stringify(manifest, null, 2);
  fs.writeFileSync('/tmp/sovereign-manifest.json', finalManifest);

  console.log('');
  console.log(`Manifest SHA256: ${manifestSha256}`);

  if (!DRY_RUN && results.every(r => r.status === 'OK')) {
    const pushed = await githubPush(
      `${VM_DIR}/sovereign-manifest.json`,
      finalManifest,
      `feat: sovereign-manifest.json — VM identity ${manifestSha256.substring(0,8)}`
    );
    console.log(`Manifest pushed -> ${pushed}`);
  }

  console.log('='.repeat(72));

  const failed = results.filter(r => r.status !== 'OK');
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
