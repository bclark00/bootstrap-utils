"use strict";
/**
 * genesis-corpus-verify.js
 *
 * Git-aware Genesis-Docs Corpus Integrity Verifier
 *
 * Algorithm:
 *   1. Working tree vs HEAD: detect uncommitted modifications/deletions
 *   2. Stub detection: identify files committed as stubs (< STUB_THRESHOLD bytes)
 *      vs their "Restore"/"Replace stub" counterparts
 *   3. Canonical-locks audit: parse CANONICAL-LOCKS-2026-01-31.md,
 *      verify locked files are present and non-stub
 *   4. RFC dependency graph: parse Parent/Dependencies headers,
 *      compute grounded set from locked RFCs outward
 *   5. Generate SHA256 manifest of current HEAD state for future anchoring
 *   6. Emit structured deviation report
 *
 * Usage:
 *   node genesis-corpus-verify.js <repo_dir> [--json] [--generate-manifest]
 *   node genesis-corpus-verify.js <repo_dir> --generate-manifest > GENESIS-MANIFEST-SHA256.txt
 *
 * Requires: git in PATH (or GIT_EXEC env var)
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const { execFileSync, execSync } = require("child_process");

const STUB_THRESHOLD = 500;   // bytes - files smaller than this are likely stubs
const STUB_MARKERS   = [
  "[RFC-",
  "writing directly",
  "placeholder",
  "PLACEHOLDER",
  "stub",
  "TODO",
  "TBD",
];

// ── Git helpers ───────────────────────────────────────────────────────────────

function findGit() {
  const candidates = [
    process.env.GIT_EXEC,
    "git",
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files\\Git\\bin\\git.exe",
  ].filter(Boolean);

  for (const g of candidates) {
    try {
      execFileSync(g, ["--version"], { stdio: "pipe" });
      return g;
    } catch {}
  }
  throw new Error("git not found. Set GIT_EXEC env var.");
}

function git(repoDir, args) {
  const GIT = findGit();
  try {
    return execFileSync(GIT, args, {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    }).trim();
  } catch (e) {
    return e.stdout ? e.stdout.trim() : "";
  }
}

// ── Working tree deviations ───────────────────────────────────────────────────

function getWorkingTreeDeviations(repoDir) {
  const raw = git(repoDir, ["diff-files", "--name-status"]);
  const deviations = [];
  if (!raw) return deviations;
  for (const line of raw.split("\n").filter(Boolean)) {
    const [status, ...pathParts] = line.split("\t");
    deviations.push({ status: status.trim(), filepath: pathParts.join("\t") });
  }
  return deviations;
}

function getUntrackedFiles(repoDir) {
  const raw = git(repoDir, ["ls-files", "--others", "--exclude-standard"]);
  return raw ? raw.split("\n").filter(Boolean) : [];
}

// ── Tracked files + object hashes ────────────────────────────────────────────

function getTrackedFiles(repoDir) {
  // mode HASH stage\tpath
  const raw = git(repoDir, ["ls-files", "-s"]);
  const files = new Map();
  for (const line of raw.split("\n").filter(Boolean)) {
    const [meta, filepath] = line.split("\t");
    const parts = meta.trim().split(/\s+/);
    const objHash = parts[1];
    if (filepath && objHash) {
      files.set(filepath, { objHash, filepath });
    }
  }
  return files;
}

// ── Stub detection ────────────────────────────────────────────────────────────

function getFileContentFromHead(repoDir, filepath) {
  return git(repoDir, ["show", "HEAD:" + filepath]);
}

function isStub(content, filepath) {
  if (content.length < STUB_THRESHOLD) return { stub: true, reason: "too small (" + content.length + " bytes)" };
  for (const marker of STUB_MARKERS) {
    const firstLine = content.split("\n")[0] || "";
    if (firstLine.includes(marker) || (content.length < 1000 && content.includes(marker))) {
      return { stub: true, reason: "stub marker: " + JSON.stringify(marker) };
    }
  }
  return { stub: false };
}

// ── Canonical locks parser ────────────────────────────────────────────────────

function parseCanonicalLocks(repoDir) {
  const lockFile = path.join(repoDir, "CANONICAL-LOCKS-2026-01-31.md");
  if (!fs.existsSync(lockFile)) return { locked: [], raw: null };

  const text = fs.readFileSync(lockFile, "utf8");
  const locked = [];

  // Extract file references: lines containing backtick paths ending in .md
  const fileRefs = text.match(/`([^`]+\.md)`/g) || [];
  for (const ref of fileRefs) {
    const filepath = ref.replace(/`/g, "").trim();
    locked.push(filepath);
  }

  return { locked: [...new Set(locked)], raw: lockFile };
}

// ── RFC dependency graph ──────────────────────────────────────────────────────

const RFC_ID_RE = /RFC-[A-Z0-9]+-[A-Z0-9-]+|RFC-[A-Z]\d{2}|RFC-\d{3}/g;

function extractRfcDeps(content) {
  const deps = new Set();
  const parentLine  = content.match(/\*\*Parent\*\*:([^\n]+)/);
  const depsLine    = content.match(/\*\*Dependenc(?:y|ies)\*\*:([^\n]+)/);
  const authorityLine = content.match(/\*\*Authority\*\*:([^\n]+)/);

  for (const line of [parentLine, depsLine, authorityLine]) {
    if (!line) continue;
    const matches = line[1].match(RFC_ID_RE) || [];
    for (const m of matches) deps.add(m);
  }
  return deps;
}

function extractRfcId(content, filepath) {
  // Try **RFC-ID**: or infer from filename
  const m = content.match(/\*\*RFC(?:-ID)?\*\*:\s*([^\s\n]+)/);
  if (m) return m[1];
  const fname = path.basename(filepath, ".md");
  const fm = fname.match(/^(RFC-[A-Z0-9-]+)/);
  return fm ? fm[1] : null;
}

// ── SHA256 manifest generator ─────────────────────────────────────────────────

function generateManifest(repoDir, trackedFiles) {
  const entries = [];
  for (const [filepath] of trackedFiles) {
    const absPath = path.join(repoDir, filepath);
    if (!fs.existsSync(absPath)) continue;
    const buf  = fs.readFileSync(absPath);
    const hash = crypto.createHash("sha256").update(buf).digest("hex");
    entries.push({ hash, filepath, size: buf.length });
  }
  entries.sort((a, b) => a.filepath.localeCompare(b.filepath));
  return entries;
}

// ── Main verification pipeline ────────────────────────────────────────────────

function verify(repoDir, opts = {}) {
  opts = { generateManifest: false, ...opts };

  // ── Phase 1: Working tree vs HEAD ─────────────────────────────────────────
  const workingDeviations = getWorkingTreeDeviations(repoDir);
  const untracked         = getUntrackedFiles(repoDir);
  const trackedFiles      = getTrackedFiles(repoDir);

  // ── Phase 2: Stub detection on HEAD ──────────────────────────────────────
  const stubs    = [];
  const fullSpec = [];
  const rfcDeps  = new Map(); // rfcId -> Set<dep_id>
  const rfcToFile= new Map(); // rfcId -> filepath
  const fileToRfc= new Map(); // filepath -> rfcId

  for (const [filepath] of trackedFiles) {
    if (!filepath.endsWith(".md")) continue;
    const content = getFileContentFromHead(repoDir, filepath);
    const stubCheck = isStub(content, filepath);

    const rfcId = extractRfcId(content, filepath);
    if (rfcId) {
      const deps = extractRfcDeps(content);
      rfcDeps.set(rfcId, deps);
      rfcToFile.set(rfcId, filepath);
      fileToRfc.set(filepath, rfcId);
    }

    if (stubCheck.stub) {
      stubs.push({ filepath, reason: stubCheck.reason, size: content.length });
    } else {
      fullSpec.push(filepath);
    }
  }

  // ── Phase 3: Canonical locks audit ───────────────────────────────────────
  const { locked } = parseCanonicalLocks(repoDir);
  const lockAudit = locked.map(lockPath => {
    // lockPath may be relative like rfcs/RFC-013-CANON-CONSERVATION-LAWS.md
    const tracked = trackedFiles.has(lockPath);
    const rfcId   = fileToRfc.get(lockPath);
    const isStubFile = stubs.find(s => s.filepath === lockPath);
    return {
      lockPath,
      tracked,
      rfcId,
      stub: !!isStubFile,
      status: !tracked ? "MISSING" : isStubFile ? "STUB" : "INTACT",
    };
  });

  // ── Phase 4: Grounded RFC set ─────────────────────────────────────────────
  // Locked non-stub RFCs are the anchor set
  const lockedIntactRfcIds = new Set(
    lockAudit.filter(a => a.status === "INTACT" && a.rfcId).map(a => a.rfcId)
  );

  // Stub RFCs undermine groundedness
  const stubRfcIds = new Set(
    stubs.map(s => fileToRfc.get(s.filepath)).filter(Boolean)
  );

  // Fixed-point grounding: start from locked intact, expand through deps
  let grounded = new Set(lockedIntactRfcIds);
  let changed  = true;
  while (changed) {
    changed = false;
    for (const [rfcId, deps] of rfcDeps) {
      if (grounded.has(rfcId)) continue;
      if (stubRfcIds.has(rfcId)) continue;
      const allMet = [...deps].every(d => grounded.has(d) || !rfcDeps.has(d));
      if (allMet) { grounded.add(rfcId); changed = true; }
    }
  }

  // Compromised: grounded RFCs whose dep chain includes a stub
  const compromised = new Set();
  for (const rfcId of grounded) {
    const deps = rfcDeps.get(rfcId) || new Set();
    for (const dep of deps) {
      if (stubRfcIds.has(dep)) { compromised.add(rfcId); break; }
    }
  }

  // ── Phase 5: Optional manifest generation ─────────────────────────────────
  let manifest = null;
  if (opts.generateManifest) {
    manifest = generateManifest(repoDir, trackedFiles);
  }

  // ── Build report ──────────────────────────────────────────────────────────
  const report = {
    schema:   "Genesis.CorpusVerify.v1",
    timestamp: new Date().toISOString(),
    repo_dir:  repoDir,

    summary: {
      tracked_files:        trackedFiles.size,
      full_specs:           fullSpec.length,
      stubs:                stubs.length,
      working_deviations:   workingDeviations.length,
      untracked:            untracked.length,
      locked_rfcs:          locked.length,
      locked_intact:        lockAudit.filter(a => a.status === "INTACT").length,
      locked_missing:       lockAudit.filter(a => a.status === "MISSING").length,
      locked_stub:          lockAudit.filter(a => a.status === "STUB").length,
      grounded_rfcs:        grounded.size,
      compromised_rfcs:     compromised.size,
      corpus_clean:         stubs.length === 0 && workingDeviations.length === 0,
    },

    working_tree_deviations: workingDeviations,
    untracked_files:         untracked,

    stubs: stubs.map(s => ({
      filepath: s.filepath,
      size:     s.size,
      reason:   s.reason,
      rfc_id:   fileToRfc.get(s.filepath) || null,
    })),

    canonical_locks_audit: lockAudit,

    dependency_analysis: {
      grounded:    [...grounded].sort(),
      compromised: [...compromised].sort(),
      stub_rfcs:   [...stubRfcIds].sort(),
    },

    manifest: manifest,

    verdict: stubs.length === 0 && workingDeviations.length === 0
      ? "CORPUS_CLEAN"
      : [
          stubs.length > 0            && `${stubs.length} STUB specs`,
          workingDeviations.length > 0 && `${workingDeviations.length} working tree deviations`,
          compromised.size > 0        && `${compromised.size} compromised RFCs`,
        ].filter(Boolean).join(", "),
  };

  return report;
}

// ── Pretty printer ────────────────────────────────────────────────────────────

function printReport(report) {
  const s = report.summary;
  console.log("\n" + "=".repeat(72));
  console.log("GENESIS-DOCS CORPUS INTEGRITY REPORT");
  console.log("=".repeat(72));
  console.log("Timestamp : " + report.timestamp);
  console.log("Repo      : " + report.repo_dir);
  console.log("");
  console.log("SUMMARY");
  console.log("  Tracked files       : " + s.tracked_files);
  console.log("  Full specs          : " + s.full_specs);
  console.log("  Stubs               : " + s.stubs);
  console.log("  Working deviations  : " + s.working_deviations);
  console.log("  Untracked files     : " + s.untracked);
  console.log("  Locked RFCs         : " + s.locked_rfcs);
  console.log("    Intact            : " + s.locked_intact);
  console.log("    Missing           : " + s.locked_missing);
  console.log("    Stub              : " + s.locked_stub);
  console.log("  Grounded RFCs       : " + s.grounded_rfcs);
  console.log("  Compromised RFCs    : " + s.compromised_rfcs);
  console.log("");

  if (s.corpus_clean) {
    console.log("VERDICT: CORPUS CLEAN");
  } else {
    console.log("VERDICT: " + report.verdict);
  }

  if (report.working_tree_deviations.length > 0) {
    console.log("\nWORKING TREE DEVIATIONS (uncommitted):");
    for (const d of report.working_tree_deviations) {
      const label = d.status === "M" ? "MODIFIED" : d.status === "D" ? "DELETED" : d.status;
      console.log("  [" + label + "] " + d.filepath);
    }
  }

  if (report.stubs.length > 0) {
    console.log("\nSTUB SPECS IN HEAD:");
    for (const s of report.stubs) {
      console.log("  " + s.filepath);
      console.log("    rfc_id : " + (s.rfc_id || "unknown"));
      console.log("    size   : " + s.size + " bytes");
      console.log("    reason : " + s.reason);
    }
  }

  const lockProblems = report.canonical_locks_audit.filter(a => a.status !== "INTACT");
  if (lockProblems.length > 0) {
    console.log("\nCANONICAL LOCK VIOLATIONS:");
    for (const a of lockProblems) {
      console.log("  [" + a.status + "] " + a.lockPath);
    }
  }

  if (report.dependency_analysis.compromised.length > 0) {
    console.log("\nCOMPROMISED RFCs (dep chain includes stub):");
    for (const id of report.dependency_analysis.compromised) {
      console.log("  " + id);
    }
  }

  if (report.dependency_analysis.stub_rfcs.length > 0) {
    console.log("\nSTUB RFC IDs:");
    for (const id of report.dependency_analysis.stub_rfcs) {
      console.log("  " + id);
    }
  }

  console.log("\n" + "=".repeat(72));
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args    = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const flags   = process.argv.slice(2).filter(a => a.startsWith("--"));
  const repoDir = args[0] || process.cwd();
  const genManifest = flags.includes("--generate-manifest");
  const jsonOut     = flags.includes("--json");

  if (flags.includes("--help") || !repoDir) {
    console.log([
      "Genesis-Docs Corpus Integrity Verifier",
      "",
      "Usage:",
      "  node genesis-corpus-verify.js <repo_dir> [options]",
      "",
      "Options:",
      "  --json                 Output raw JSON report",
      "  --generate-manifest    Include SHA256 manifest of current HEAD in report",
      "  --help                 Show help",
      "",
      "Exit codes:",
      "  0  Corpus clean",
      "  1  Issues detected",
      "  2  Error",
    ].join("\n"));
    process.exit(0);
  }

  try {
    const report = verify(repoDir, { generateManifest: genManifest });
    if (jsonOut) {
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

module.exports = { verify, generateManifest };
