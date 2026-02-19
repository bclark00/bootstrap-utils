"use strict";
/**
 * stcs-corpus-verify.js
 *
 * STCS Corpus Integrity Verification Tool
 *
 * Algorithm:
 *   1. Parse manifest (SHA256 + size ground truth)
 *   2. Hash all specs in corpus dir
 *   3. Detect: INTACT | DEVIATED | MISSING | UNREGISTERED
 *   4. Build dependency lattice from spec headers
 *   5. Run fixed-point reachability over intact specs
 *   6. Flag specs whose deps are deviated/missing (transitively compromised)
 *   7. For deviated specs: compute reconstruction confidence from dep lattice
 *   8. Emit structured deviation report
 *
 * Zero external dependencies. Uses only Node.js built-ins.
 *
 * Usage:
 *   node stcs-corpus-verify.js <manifest_path> <specs_dir>
 *   node stcs-corpus-verify.js --help
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

// ── Manifest parser ───────────────────────────────────────────────────────────

function parseManifest(manifestPath) {
  const lines = fs.readFileSync(manifestPath, "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const entries = new Map(); // basename -> { hash, relpath, size }
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [hash, relpath, size] = parts;
    const basename = path.basename(relpath);
    entries.set(basename, {
      hash:    hash.toLowerCase(),
      relpath,
      size:    size ? parseInt(size, 10) : null,
    });
  }
  return entries;
}

// ── File hasher ───────────────────────────────────────────────────────────────

function hashFile(filepath) {
  const buf = fs.readFileSync(filepath);
  return {
    hash: crypto.createHash("sha256").update(buf).digest("hex"),
    size: buf.length,
  };
}

// ── Dependency extractor ──────────────────────────────────────────────────────
// Parses **Dependencies**: lines from spec headers.
// Returns Set of STCS-XXXX-YYY doc-ids referenced.

const STCS_ID_RE = /STCS-[A-Z0-9]+-\d{3}(?:-APP-[A-Z]|-PATCHSET-\d+)?|STCS-\d{2}/g;

function extractDeps(specPath) {
  const text = fs.readFileSync(specPath, "utf8");
  const deps = new Set();

  // Scan **Dependencies**: section (single line or multi-line list)
  const depSection = text.match(/\*\*Dependencies\*\*:?([\s\S]*?)(?=\n\*\*|\n##|$)/);
  if (depSection) {
    const matches = depSection[1].match(STCS_ID_RE) || [];
    for (const m of matches) deps.add(m);
  }

  // Also scan **Authority**: line for additional references
  const authLine = text.match(/\*\*Authority\*\*:([^\n]+)/);
  if (authLine) {
    const matches = authLine[1].match(STCS_ID_RE) || [];
    for (const m of matches) deps.add(m);
  }

  return deps;
}

// Extract Doc-ID from spec header
function extractDocId(specPath) {
  const text = fs.readFileSync(specPath, "utf8");
  const m = text.match(/\*\*Doc-ID\*\*:\s*([^\s\n]+)/);
  return m ? m[1].trim() : null;
}

// Extract receipt closure hash if present
function extractReceiptHash(specPath) {
  const text = fs.readFileSync(specPath, "utf8");
  const m = text.match(/"hash":\s*"sha256:([a-f0-9]+)"/);
  return m ? m[1] : null;
}

// ── Fixed-point reachability ──────────────────────────────────────────────────
// Given intact spec set and dep graph, compute which specs are
// "fully grounded" (all deps intact transitively).

function computeGrounded(intactIds, depGraph) {
  // depGraph: Map<doc_id, Set<dep_id>>
  // Start with specs that have zero deps or all deps in intactIds
  let grounded = new Set();
  let changed = true;

  while (changed) {
    changed = false;
    for (const [id, deps] of depGraph) {
      if (grounded.has(id)) continue;
      if (!intactIds.has(id)) continue;
      const allDepsMet = [...deps].every(d =>
        grounded.has(d) || !depGraph.has(d) // external deps (RFC-013 etc.) treated as given
      );
      if (allDepsMet) {
        grounded.add(id);
        changed = true;
      }
    }
  }
  return grounded;
}

// ── Reconstruction confidence ─────────────────────────────────────────────────
// For a deviated spec, estimate how well it can be reconstructed
// from the dependency lattice.

function reconstructionConfidence(docId, depGraph, groundedIds, intactIds) {
  const deps = depGraph.get(docId) || new Set();
  if (deps.size === 0) return { confidence: 0.5, reason: "root spec - structure known, constants uncertain" };

  const totalDeps   = deps.size;
  const groundedDeps = [...deps].filter(d => groundedIds.has(d) || !depGraph.has(d)).length;
  const ratio = groundedDeps / totalDeps;

  let confidence, reason;
  if (ratio === 1.0) {
    confidence = 0.85;
    reason = "all deps grounded - structure reconstructible, constants ~85%";
  } else if (ratio >= 0.75) {
    confidence = 0.65;
    reason = `${groundedDeps}/${totalDeps} deps grounded - partial reconstruction viable`;
  } else if (ratio >= 0.5) {
    confidence = 0.40;
    reason = `${groundedDeps}/${totalDeps} deps grounded - skeleton only`;
  } else {
    confidence = 0.15;
    reason = `${groundedDeps}/${totalDeps} deps grounded - insufficient evidence`;
  }

  return { confidence, reason, grounded_deps: groundedDeps, total_deps: totalDeps };
}

// ── Main verification pipeline ────────────────────────────────────────────────

function verify(manifestPath, specsDir) {
  console.error("[corpus-verify] Loading manifest: " + manifestPath);
  console.error("[corpus-verify] Specs directory: " + specsDir);

  const manifest = parseManifest(manifestPath);
  console.error("[corpus-verify] Manifest entries: " + manifest.size);

  // ── Phase 1: Hash all files in specs dir ──────────────────────────────────
  const specFiles = fs.readdirSync(specsDir)
    .filter(f => f.endsWith(".md") || f.endsWith(".txt"))
    .sort();

  const fileResults = new Map(); // basename -> { hash, size, filepath }
  for (const f of specFiles) {
    const fp = path.join(specsDir, f);
    const { hash, size } = hashFile(fp);
    fileResults.set(f, { hash, size, filepath: fp });
  }

  // ── Phase 2: Compare against manifest ────────────────────────────────────
  const intact       = new Map(); // basename -> entry
  const deviated     = new Map(); // basename -> { expected, actual }
  const missing      = new Map(); // basename -> manifest entry
  const unregistered = new Map(); // basename -> { hash, size }

  const manifestBasename = path.basename(manifestPath);

  for (const [basename, entry] of manifest) {
    // The manifest cannot verify itself (bootstrap paradox) — skip self-entry
    if (basename === manifestBasename) {
      intact.set(basename, entry); // treat as intact for summary counts
      continue;
    }
    if (!fileResults.has(basename)) {
      missing.set(basename, entry);
    } else {
      const actual = fileResults.get(basename);
      if (actual.hash === entry.hash) {
        intact.set(basename, entry);
      } else {
        deviated.set(basename, {
          expected_hash: entry.hash,
          actual_hash:   actual.hash,
          expected_size: entry.size,
          actual_size:   actual.size,
          size_delta:    actual.size - (entry.size || actual.size),
        });
      }
    }
  }

  for (const [basename, result] of fileResults) {
    if (!manifest.has(basename)) {
      unregistered.set(basename, result);
    }
  }

  // ── Phase 3: Build dependency lattice ────────────────────────────────────
  const docIdToBasename = new Map(); // doc_id -> basename
  const depGraph        = new Map(); // doc_id -> Set<dep_id>
  const intactDocIds    = new Set();

  for (const [basename, entry] of intact) {
    const fp = path.join(specsDir, basename);
    if (!basename.endsWith(".md")) continue;
    const docId = extractDocId(fp);
    if (!docId) continue;
    docIdToBasename.set(docId, basename);
    depGraph.set(docId, extractDeps(fp));
    intactDocIds.add(docId);
  }

  // Also build dep graph entries for deviated specs (so we can assess compromise)
  const deviatedDocIds = new Set();
  for (const [basename] of deviated) {
    const fp = path.join(specsDir, basename);
    if (!basename.endsWith(".md")) continue;
    const docId = extractDocId(fp);
    if (!docId) continue;
    docIdToBasename.set(docId, basename);
    if (!depGraph.has(docId)) depGraph.set(docId, extractDeps(fp));
    deviatedDocIds.add(docId);
  }

  // ── Phase 4: Fixed-point grounded set ────────────────────────────────────
  const groundedIds = computeGrounded(intactDocIds, depGraph);

  // ── Phase 5: Transitively compromised ────────────────────────────────────
  // Intact specs whose dep chain includes a deviated or missing spec
  const compromised = new Set();
  for (const docId of intactDocIds) {
    const deps = depGraph.get(docId) || new Set();
    for (const dep of deps) {
      if (deviatedDocIds.has(dep) || !intactDocIds.has(dep) && depGraph.has(dep)) {
        compromised.add(docId);
        break;
      }
    }
  }

  // ── Phase 6: Reconstruction assessment for deviated specs ─────────────────
  const reconstructionMap = new Map();
  for (const docId of deviatedDocIds) {
    reconstructionMap.set(docId, reconstructionConfidence(docId, depGraph, groundedIds, intactDocIds));
  }

  // ── Build report ─────────────────────────────────────────────────────────
  const report = {
    schema:    "STCS.CorpusVerify.v1",
    timestamp: new Date().toISOString(),
    manifest:  manifestPath,
    specs_dir: specsDir,

    summary: {
      total_manifest:  manifest.size,
      total_on_disk:   fileResults.size,
      intact:          intact.size,
      deviated:        deviated.size,
      missing:         missing.size,
      unregistered:    unregistered.size,
      grounded:        groundedIds.size,
      compromised:     compromised.size,
      corpus_clean:    deviated.size === 0 && missing.size === 0,
    },

    intact: [...intact.keys()].sort(),

    deviated: Object.fromEntries(
      [...deviated.entries()].map(([basename, info]) => {
        const fp    = path.join(specsDir, basename);
        const docId = extractDocId(fp);
        const rec   = docId ? reconstructionMap.get(docId) : null;
        return [basename, {
          ...info,
          doc_id: docId,
          reconstruction: rec,
        }];
      })
    ),

    missing: Object.fromEntries(
      [...missing.entries()].map(([basename, entry]) => [basename, entry])
    ),

    unregistered: [...unregistered.keys()].sort(),

    dependency_lattice: {
      grounded:     [...groundedIds].sort(),
      compromised:  [...compromised].map(id => ({
        doc_id:   id,
        basename: docIdToBasename.get(id),
      })),
      deviated_ids: [...deviatedDocIds].sort(),
    },

    verdict: deviated.size === 0 && missing.size === 0
      ? "CORPUS_CLEAN — all specs match canonical manifest"
      : `CORPUS_DEVIATED — ${deviated.size} deviated, ${missing.size} missing, ${compromised.size} transitively compromised`,
  };

  return report;
}

// ── Pretty printer ────────────────────────────────────────────────────────────

function printReport(report) {
  const s = report.summary;

  console.log("\n" + "=".repeat(72));
  console.log("STCS CORPUS INTEGRITY REPORT");
  console.log("=".repeat(72));
  console.log("Timestamp : " + report.timestamp);
  console.log("Manifest  : " + report.manifest);
  console.log("Specs dir : " + report.specs_dir);
  console.log("");
  console.log("SUMMARY");
  console.log("  Manifest entries  : " + s.total_manifest);
  console.log("  Files on disk     : " + s.total_on_disk);
  console.log("  Intact            : " + s.intact + (s.intact === s.total_manifest ? " (ALL)" : ""));
  console.log("  Deviated          : " + s.deviated);
  console.log("  Missing           : " + s.missing);
  console.log("  Unregistered      : " + s.unregistered);
  console.log("  Grounded (full)   : " + s.grounded);
  console.log("  Compromised (tran): " + s.compromised);
  console.log("");

  if (s.corpus_clean) {
    console.log("VERDICT: CORPUS CLEAN");
    console.log("  All " + s.intact + " specs match canonical manifest hashes.");
    console.log("  " + s.grounded + " specs fully grounded in dependency lattice.");
  } else {
    console.log("VERDICT: " + report.verdict);
  }

  if (Object.keys(report.deviated).length > 0) {
    console.log("\nDEVIATED SPECS:");
    for (const [basename, info] of Object.entries(report.deviated)) {
      console.log("  " + basename);
      console.log("    doc_id         : " + (info.doc_id || "unknown"));
      console.log("    expected_hash  : " + info.expected_hash.substring(0, 16) + "...");
      console.log("    actual_hash    : " + info.actual_hash.substring(0, 16) + "...");
      console.log("    size_delta     : " + (info.size_delta >= 0 ? "+" : "") + info.size_delta + " bytes");
      if (info.reconstruction) {
        const r = info.reconstruction;
        console.log("    reconstruction : " + (r.confidence * 100).toFixed(0) + "% confidence");
        console.log("                     " + r.reason);
      }
    }
  }

  if (Object.keys(report.missing).length > 0) {
    console.log("\nMISSING SPECS (in manifest, not on disk):");
    for (const [basename, entry] of Object.entries(report.missing)) {
      console.log("  " + basename + "  [" + entry.hash.substring(0, 16) + "...]");
    }
  }

  if (report.unregistered.length > 0) {
    console.log("\nUNREGISTERED FILES (on disk, not in manifest):");
    for (const f of report.unregistered) {
      console.log("  " + f);
    }
  }

  if (report.dependency_lattice.compromised.length > 0) {
    console.log("\nTRANSITIVELY COMPROMISED (intact but dep chain deviated):");
    for (const { doc_id, basename } of report.dependency_lattice.compromised) {
      console.log("  " + doc_id + "  (" + basename + ")");
    }
  }

  console.log("\n" + "=".repeat(72));
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.length === 0) {
    console.log([
      "STCS Corpus Integrity Verifier",
      "",
      "Usage:",
      "  node stcs-corpus-verify.js <manifest_path> <specs_dir>",
      "  node stcs-corpus-verify.js <manifest_path> <specs_dir> --json",
      "",
      "Arguments:",
      "  manifest_path  Path to STCS-MANIFEST-SHA256-v1.0.txt",
      "  specs_dir      Directory containing spec .md files",
      "",
      "Options:",
      "  --json         Output raw JSON report instead of formatted text",
      "  --help         Show this help",
      "",
      "Exit codes:",
      "  0  Corpus clean",
      "  1  Deviations detected",
      "  2  Error",
    ].join("\n"));
    process.exit(0);
  }

  if (args.length < 2) {
    console.error("Error: manifest_path and specs_dir required");
    process.exit(2);
  }

  const [manifestPath, specsDir] = args;
  const jsonOutput = args.includes("--json");

  try {
    const report = verify(manifestPath, specsDir);

    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }

    process.exit(report.summary.corpus_clean ? 0 : 1);

  } catch (e) {
    console.error("Error: " + e.message);
    process.exit(2);
  }
}

module.exports = { verify, parseManifest, extractDeps, computeGrounded };
