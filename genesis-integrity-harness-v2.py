#!/usr/bin/env python3
"""
Genesis Corpus Integrity Harness v2
RFC-AUDIT-001 / RFC-013 / RFC-SPINE-001 conformant

Layer 1: SHA-256 content-addressing (tamper detection)
Layer 2: Semantic completeness (defacement detection)
  - CETrace v1.2 governance field assertions
  - RFC-013 conservation law presence checks
  - SGIR RFC canonical section assertions
  - Cross-reference validation
"""

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── Constants ────────────────────────────────────────────────────────────────

REPOS = {
    "Genesis-Docs":            "/tmp/audit/Genesis-Docs",
    "tool-cdn":                "/tmp/audit/tool-cdn",
    "distributed-scout":       "/tmp/audit/distributed-scout",
    "session-crystallization":  "/tmp/audit/session-crystallization",
    "bootstrap-utils":         "/home/claude/bootstrap-utils",
}

EXCLUDE_DIRS = {".git", "__pycache__", ".github"}

# ── Hashing ───────────────────────────────────────────────────────────────────

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"

def sha256_str(s: str) -> str:
    return f"sha256:{hashlib.sha256(s.encode('utf-8')).hexdigest()}"

def canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

# ── Corpus scan ───────────────────────────────────────────────────────────────

def scan_repo(name: str, root: str) -> list:
    entries = []
    root_path = Path(root)
    if not root_path.exists():
        return entries
    for path in sorted(root_path.rglob("*")):
        if path.is_dir():
            continue
        if any(ex in path.parts for ex in EXCLUDE_DIRS):
            continue
        rel = str(path.relative_to(root_path))
        content_hash = sha256_file(path)
        entries.append({
            "repo":         name,
            "path":         rel,
            "content_hash": content_hash,
            "size_bytes":   path.stat().st_size,
        })
    return entries

# ── Layer 1: Content-hash analysis ───────────────────────────────────────────

def analyze_hashes(all_entries: list) -> dict:
    by_name = {}
    for e in all_entries:
        name = Path(e["path"]).name
        by_name.setdefault(name, []).append(e)

    by_hash = {}
    for e in all_entries:
        by_hash.setdefault(e["content_hash"], []).append(e)

    tamper_candidates = []
    for name, entries in by_name.items():
        hashes = set(e["content_hash"] for e in entries)
        if len(hashes) > 1:
            tamper_candidates.append({
                "filename": name,
                "copies": [{"repo": e["repo"], "path": e["path"],
                            "content_hash": e["content_hash"],
                            "size_bytes": e["size_bytes"]} for e in entries],
                "divergence": "SAME_NAME_DIFFERENT_HASH",
            })

    exact_duplicates = []
    for h, entries in by_hash.items():
        if len(entries) > 1:
            exact_duplicates.append({
                "content_hash": h,
                "copies": [{"repo": e["repo"], "path": e["path"]} for e in entries],
            })

    return {"tamper_candidates": tamper_candidates, "exact_duplicates": exact_duplicates}

# ── Layer 2: Semantic completeness checks ────────────────────────────────────

class SemanticCheck:
    def __init__(self, name: str, path: str):
        self.name = name
        self.path = path
        self.passed = []
        self.failed = []
        self.warnings = []

    def assert_true(self, condition: bool, label: str, detail: str = ""):
        if condition:
            self.passed.append(label)
        else:
            self.failed.append({"check": label, "detail": detail})

    def warn(self, label: str, detail: str = ""):
        self.warnings.append({"check": label, "detail": detail})

    @property
    def ok(self) -> bool:
        return len(self.failed) == 0


def check_cetrace_v12(genesis_docs_root: str) -> SemanticCheck:
    """
    Assert that cetrace-v1.2-promotion-schema.json has all governance fields
    that were surgically removed in the Feb 16 defaced bundle.
    """
    path = os.path.join(genesis_docs_root,
                        "supporting-specs", "cetrace-v1.2-promotion-schema.json")
    chk = SemanticCheck("CETrace-v1.2 Governance Field Completeness", path)

    if not os.path.exists(path):
        chk.failed.append({"check": "file_exists", "detail": f"Missing: {path}"})
        return chk

    with open(path) as f:
        try:
            schema = json.load(f)
        except json.JSONDecodeError as e:
            chk.failed.append({"check": "json_valid", "detail": str(e)})
            return chk

    props = schema.get("properties", {})

    # 1. trace_version must exist
    chk.assert_true(
        "trace_version" in props,
        "properties.trace_version present",
        "Defaced bundle removed trace_version entirely"
    )

    # 2. Description must reference RFC-013
    desc = schema.get("description", "")
    chk.assert_true(
        "RFC-013" in desc and "conservation laws" in desc.lower(),
        "description references RFC-013 conservation laws",
        f"Got description: {desc[:120]!r}"
    )

    # 3. promotion_analysis.properties must exist with governance fields
    pa = props.get("promotion_analysis", {})
    pa_props = pa.get("properties", {})
    chk.assert_true(
        bool(pa_props),
        "promotion_analysis.properties is non-empty",
        "Defaced bundle stripped all promotion_analysis.properties"
    )
    for field in ("governance_state_hash_before", "governance_state_hash_after",
                  "candidate_id", "readiness_score", "decision", "decision_reason",
                  "auto_approval_eligible", "criteria_met", "criteria_gates"):
        chk.assert_true(
            field in pa_props,
            f"promotion_analysis.properties.{field} present",
            "Field was surgically removed in Feb 16 defacement"
        )

    # 4. promotion_analysis.required must be non-empty
    pa_req = pa.get("required", [])
    chk.assert_true(
        len(pa_req) >= 1,
        "promotion_analysis.required is non-empty",
        "Defaced bundle removed required[] entirely, disabling field validation"
    )

    # 5. rollback_analysis.properties must exist with governance fields
    ra = props.get("rollback_analysis", {})
    ra_props = ra.get("properties", {})
    chk.assert_true(
        bool(ra_props),
        "rollback_analysis.properties is non-empty",
        "Defaced bundle stripped all rollback_analysis.properties"
    )
    for field in ("governance_state_hash_before", "governance_state_hash_after",
                  "baseline_effectiveness", "current_effectiveness",
                  "should_rollback", "rollback_reason"):
        chk.assert_true(
            field in ra_props,
            f"rollback_analysis.properties.{field} present",
            "Field was surgically removed in Feb 16 defacement"
        )

    # 6. rollback_analysis.required must be non-empty
    ra_req = ra.get("required", [])
    chk.assert_true(
        len(ra_req) >= 1,
        "rollback_analysis.required is non-empty",
        "Defaced bundle removed required[] entirely"
    )

    return chk


def check_rfc013_conservation_laws(genesis_docs_root: str) -> SemanticCheck:
    """
    Assert RFC-013 contains all three conservation laws and key invariants.
    These are the physics laws that the defacement campaign targets.
    """
    # Try both locations
    candidates = [
        os.path.join(genesis_docs_root, "rfcs", "RFC-013-CANON-CONSERVATION-LAWS.md"),
        os.path.join(genesis_docs_root, "rfcs", "RFC-013-CANON-CONSERVATION-LAWS",
                     "RFC-013-CANON-CONSERVATION-LAWS.md"),
    ]
    path = next((p for p in candidates if os.path.exists(p)), None)
    chk = SemanticCheck("RFC-013 Conservation Laws Completeness",
                        path or candidates[0])

    if not path:
        chk.failed.append({"check": "file_exists", "detail": "RFC-013 not found"})
        return chk

    content = Path(path).read_text(encoding="utf-8", errors="replace")

    # Three conservation laws
    for law, key_phrase in [
        ("1.1 Conservation of Identity",
         "Content changes create new identity"),
        ("1.2 Conservation of Truth",
         "Same inputs produce same outputs"),
        ("1.3 Conservation of Governance",
         "State transitions are one-way"),
    ]:
        chk.assert_true(
            law in content,
            f"Section '{law}' present",
            "Conservation law section missing from RFC-013"
        )
        chk.assert_true(
            key_phrase in content,
            f"Key principle for {law[:3]} present: {key_phrase!r}",
            "Principle text missing - possible truncation or defacement"
        )

    # neuron_id hash formula must be present (identity law enforcement)
    chk.assert_true(
        "neuron_id" in content and "sha256" in content.lower() and "canonicalizeJSON" in content,
        "Identity hash formula (neuron_id + sha256 + canonicalizeJSON) present",
        "Hash formula is the mechanical enforcement of Conservation of Identity"
    )

    # Governance state machine must be present
    chk.assert_true(
        "proposed" in content and "evaluated" in content and "active" in content,
        "Governance lifecycle state machine present",
        "State machine defines Conservation of Governance enforcement"
    )

    # Canonicalization section
    chk.assert_true(
        "2.2 JSON Canonicalization" in content,
        "Section 2.2 JSON Canonicalization present",
        "Canonicalization rules are required for deterministic hash reproduction"
    )

    # RFC 8785 reference (the spec mandates JCS)
    chk.assert_true(
        "RFC 8785" in content or "JCS" in content,
        "RFC 8785 / JCS reference present in canonicalization rules",
        "Without JCS reference, implementations can use non-conformant stringify"
    )

    # Formal verification tests section
    chk.assert_true(
        "7. Formal Verification Tests" in content,
        "Section 7 Formal Verification Tests present",
        "Test suite section missing - spec is incomplete without conformance tests"
    )

    return chk


def check_sgir_reinforce_completeness(genesis_docs_root: str) -> SemanticCheck:
    """
    RFC-SGIR-REINFORCE-001 has two versions: a 15,607-byte canonical with
    15 sections (including governance integration) and a 10,612-byte truncated
    copy missing sections 8-15. Assert the canonical version is authoritative.
    """
    canonical_path = os.path.join(
        genesis_docs_root, "rfcs", "RFC-SGIR-NF-001", "RFC-SGIR-REINFORCE-001.md")
    truncated_path = os.path.join(
        genesis_docs_root, "rfcs", "RFC-SGIR-REINFORCE-001", "RFC-SGIR-REINFORCE-001.md")

    chk = SemanticCheck("RFC-SGIR-REINFORCE-001 Canonical Completeness",
                        canonical_path)

    # Canonical version must exist
    chk.assert_true(
        os.path.exists(canonical_path),
        "Canonical RFC-SGIR-REINFORCE-001 (in RFC-SGIR-NF-001/) exists",
        "Canonical 15,607-byte version is missing"
    )

    if not os.path.exists(canonical_path):
        return chk

    content = Path(canonical_path).read_text(encoding="utf-8", errors="replace")
    size = os.path.getsize(canonical_path)

    # Size sanity check (canonical is ~15,607 bytes)
    chk.assert_true(
        size >= 15000,
        f"Canonical version size >= 15000 bytes (got {size})",
        "File is smaller than canonical - possible truncation"
    )

    # Required sections that are absent from the truncated copy
    for section in [
        "8. Governance Integration",
        "8.1 Rule Promotion",
        "8.2 Rule Versioning",
        "8.3 Rule Audit Trail",
        "9. Conformance Tests",
        "10. Canonical Reinforcement Examples",
        "11. Reference Implementation Outline",
        "12. Failure Modes",
        "15. Canon Decision",
    ]:
        chk.assert_true(
            section in content,
            f"Section '{section}' present in canonical",
            "Section absent from canonical - may indicate truncation"
        )

    # Governance gating must be explicitly present
    chk.assert_true(
        "9.5 Governance Gating" in content or "Governance Gating" in content,
        "Governance Gating conformance test present",
        "Governance gating test is missing from REINFORCE spec"
    )

    # Warn about truncated copy if present (not a failure, but notable)
    if os.path.exists(truncated_path):
        truncated_size = os.path.getsize(truncated_path)
        if truncated_size < size:
            chk.warn(
                f"Truncated copy present at RFC-SGIR-REINFORCE-001/ ({truncated_size} bytes vs {size} bytes canonical)",
                "Truncated copy is 32% smaller, missing governance integration sections"
            )

    return chk


def check_cetrace_defaced_bundle_absent(genesis_docs_root: str) -> SemanticCheck:
    """
    The defaced CETrace schema was introduced via 'cetrace_v1.2_promotion_schema_DEFACED.json'
    equivalent. Check that no copy of the defaced schema (identified by hash) is present
    in an authoritative location.

    Known defaced hash: Any cetrace_v1.2 schema that lacks governance_state_hash fields.
    We check by loading and inspecting rather than hash (hash may differ by copy).
    """
    chk = SemanticCheck("CETrace Defaced Bundle Absence Check", genesis_docs_root)

    # Look for any cetrace v1.2 promotion schemas
    root = Path(genesis_docs_root)
    candidates = list(root.rglob("cetrace_v1.2*promotion*.json")) + \
                 list(root.rglob("cetrace-v1.2*promotion*.json"))

    for candidate in candidates:
        try:
            with open(candidate) as f:
                schema = json.load(f)
        except Exception:
            continue

        props = schema.get("properties", {})
        pa_props = props.get("promotion_analysis", {}).get("properties", {})
        has_gov_hash = (
            "governance_state_hash_before" in pa_props or
            "governance_state_hash_after" in pa_props
        )

        if not has_gov_hash and props.get("promotion_analysis"):
            # promotion_analysis exists but has no governance hash fields = defaced
            chk.failed.append({
                "check": f"Defaced schema detected",
                "detail": (
                    f"File {candidate.relative_to(root)} has promotion_analysis "
                    f"but is MISSING governance_state_hash fields. "
                    f"This matches the Feb 16 defacement signature."
                )
            })
        elif has_gov_hash:
            chk.passed.append(
                f"{candidate.relative_to(root)}: governance_state_hash fields present (clean)"
            )

    if not candidates:
        chk.warn(
            "No cetrace v1.2 promotion schemas found to inspect",
            "Expected at least cetrace-v1.2-promotion-schema.json in supporting-specs/"
        )

    return chk


def check_rfc013_cross_references(genesis_docs_root: str) -> SemanticCheck:
    """
    CETrace v1.2 schema description must reference RFC-013.
    RFC-SGIR-NF-001 conformance tests should reference RFC-013 compliance.
    RFC-013 itself should reference CETrace as an implementation.
    """
    chk = SemanticCheck("RFC-013 Cross-Reference Integrity", genesis_docs_root)

    # CETrace -> RFC-013 reference
    cetrace_path = os.path.join(genesis_docs_root,
                                "supporting-specs", "cetrace-v1.2-promotion-schema.json")
    if os.path.exists(cetrace_path):
        with open(cetrace_path) as f:
            content = f.read()
        chk.assert_true(
            "RFC-013" in content,
            "cetrace-v1.2 schema references RFC-013",
            "The defacement erased the RFC-013 reference from the description"
        )

    # RFC-SGIR-REINFORCE-001 (canonical) -> RFC-013 compliance
    reinforce_canonical = os.path.join(
        genesis_docs_root, "rfcs", "RFC-SGIR-NF-001", "RFC-SGIR-REINFORCE-001.md")
    if os.path.exists(reinforce_canonical):
        content = Path(reinforce_canonical).read_text(encoding="utf-8", errors="replace")
        chk.assert_true(
            "RFC-013" in content,
            "Canonical RFC-SGIR-REINFORCE-001 references RFC-013",
            "Governance compliance reference missing from REINFORCE spec"
        )
        chk.assert_true(
            "5. Bounds & Quantization" in content and "RFC-013 Compliance" in content,
            "Section 5 RFC-013 Compliance present in REINFORCE canonical",
            "RFC-013 compliance section missing from bounds/quantization section"
        )

    # RFC-013 references its implementors
    rfc013_path = os.path.join(genesis_docs_root, "rfcs",
                               "RFC-013-CANON-CONSERVATION-LAWS.md")
    if os.path.exists(rfc013_path):
        content = Path(rfc013_path).read_text(encoding="utf-8", errors="replace")
        # RFC-013 should reference CETrace and SGIR as implementations
        chk.assert_true(
            "CETrace" in content or "cetrace" in content.lower(),
            "RFC-013 references CETrace as implementation",
            "RFC-013 should reference CETrace governance state hashing"
        )

    return chk


def check_x01_guardian(tool_cdn_root: str) -> SemanticCheck:
    """
    Assert x01-guardian.js is the canonical implementation, not the Feb 22 stub.

    Stub signature (committed 2026-02-22):
      - detectCorruption() returns { detected: false } unconditionally
      - All repair pathways (_activateBER/NER/DSB/MMR) return true unconditionally
      - No SQLite queries present
      - ES module export (export default) incompatible with CJS require()

    Canonical signature:
      - detectCorruption() queries sgir_codon, verifies sha256(codon_canon)
      - Repair pathways wire to DIS, catabolism, SGIR
      - module.exports = { X01Guardian }
    """
    path = os.path.join(tool_cdn_root, "x01-guardian.js")
    chk = SemanticCheck("X01Guardian Canonical Implementation (not stub)", path)

    if not os.path.exists(path):
        chk.failed.append({"check": "file_exists", "detail": f"Missing: {path}"})
        return chk

    content = Path(path).read_text(encoding="utf-8", errors="replace")
    size = os.path.getsize(path)

    # Size check — stub was 8,242 bytes, canonical is ~20,565 bytes
    chk.assert_true(
        size >= 15000,
        f"File size >= 15000 bytes (got {size}) — stub was 8,242",
        "File is stub-sized. Canonical implementation is ~20KB."
    )

    # Stub detection: always-false detectCorruption
    chk.assert_true(
        "return { detected: false" not in content,
        "detectCorruption() does not return always-false stub",
        "Stub pattern: 'return { detected: false' — guardian is blind"
    )

    # Stub detection: unconditional repair returns
    for pathway in ["_activateBER", "_activateNER", "_activateDSB", "_activateMMR"]:
        # Stub returns true immediately after a console.log with no real logic
        stub_pattern = f"return true; // Stub"
        # Count occurrences — canonical has none, stub has 4
        chk.assert_true(
            content.count("return true; // Stub") == 0,
            f"No 'return true // Stub' patterns present (repair pathways are real)",
            f"Found stub return pattern — repair pathways are non-functional"
        )
        break  # one check covers all 4

    # Canonical detection: real DB queries
    chk.assert_true(
        "SELECT codon_id, codon_canon FROM sgir_codon" in content,
        "detectCorruption() contains real codon hash query",
        "Missing DB query — canonical verifies sha256(codon_canon) for each codon"
    )

    chk.assert_true(
        "SELECT genome_id, codon_sequence, genome_canon FROM sgir_genome" in content,
        "detectCorruption() contains genome consistency query",
        "Missing genome query — canonical checks codon_sequence references exist"
    )

    # Real repair wiring
    chk.assert_true(
        "dis.readShardConsensus" in content,
        "BER pathway wired to DIS readShardConsensus()",
        "BER not wired to DIS — canonical fetches consensus shard for repair"
    )

    chk.assert_true(
        "cat.catabolize" in content and "cat.emulsify" in content,
        "NER pathway wired to catabolism (catabolize + emulsify)",
        "NER not wired to CatabolismEngine — canonical re-catabolizes genomes"
    )

    chk.assert_true(
        "dis.coordinateSubstrateRecovery" in content,
        "DSB pathway wired to DIS coordinateSubstrateRecovery()",
        "DSB not wired to DIS — canonical coordinates substrate recovery"
    )

    chk.assert_true(
        "UPDATE ledger_translation SET genome_id" in content,
        "MMR pathway updates ledger_translation references",
        "MMR not wired — canonical re-derives genome_id and updates ledger"
    )

    # Module format: must be CJS for tool-cdn compatibility
    chk.assert_true(
        "module.exports" in content,
        "Uses module.exports (CJS compatible)",
        "Stub used 'export default' (ES module) — breaks require() in tool-cdn"
    )

    # quarantined[] tracking must be present
    chk.assert_true(
        "this.quarantined" in content,
        "quarantined[] array present for tracking beyond-repair items",
        "Stub removed quarantined[] — quarantine state not tracked"
    )

    return chk


def check_x01_proof(tool_cdn_root: str) -> SemanticCheck:
    """
    Assert rfc-x01-proof-001.js is present with full FVT-01 suite.
    This file was absent from tool-cdn entirely before 2026-02-24.
    """
    path = os.path.join(tool_cdn_root, "rfc-x01-proof-001.js")
    chk = SemanticCheck("RFC-X01-PROOF-001 FVT-01 Reference Implementation", path)

    if not os.path.exists(path):
        chk.failed.append({
            "check": "file_exists",
            "detail": "rfc-x01-proof-001.js absent — was never committed to tool-cdn before Feb 24"
        })
        return chk

    content = Path(path).read_text(encoding="utf-8", errors="replace")

    # Core X-01 components
    for symbol in ["function X01(", "function computeLFP(", "function computeGFP(",
                   "function Obs(", "function conflictCore(", "function detGreedyMin("]:
        chk.assert_true(
            symbol in content,
            f"{symbol.strip()} present",
            "Required X-01 function missing from proof implementation"
        )

    # FVT-01 test suite
    chk.assert_true(
        "function runFVT01()" in content,
        "runFVT01() conformance suite present",
        "FVT-01 test runner missing"
    )

    # Key test coverage
    for test in ["G-01", "G-02", "G-03", "M-01", "M-02", "M-03", "V-01", "V-02", "V-03"]:
        chk.assert_true(
            test in content,
            f"FVT-01 test {test} present",
            f"Conformance test {test} missing from suite"
        )

    # Schema outputs
    chk.assert_true(
        "X01.Result.v1" in content and "X01.NoResult.v1" in content,
        "Both X01.Result.v1 and X01.NoResult.v1 schemas present",
        "Output schema identifiers missing"
    )

    return chk


def run_semantic_checks(repos: dict) -> list:
    """Run all semantic checks. Returns list of SemanticCheck results."""
    genesis_docs = repos.get("Genesis-Docs", "/tmp/audit/Genesis-Docs")
    tool_cdn = repos.get("tool-cdn", "/tmp/audit/tool-cdn")
    checks = []

    if os.path.exists(genesis_docs):
        checks.append(check_cetrace_v12(genesis_docs))
        checks.append(check_rfc013_conservation_laws(genesis_docs))
        checks.append(check_sgir_reinforce_completeness(genesis_docs))
        checks.append(check_cetrace_defaced_bundle_absent(genesis_docs))
        checks.append(check_rfc013_cross_references(genesis_docs))
    else:
        print(f"  [WARN] Genesis-Docs not found at {genesis_docs}, skipping Genesis-Docs checks")

    if os.path.exists(tool_cdn):
        checks.append(check_x01_guardian(tool_cdn))
        checks.append(check_x01_proof(tool_cdn))
    else:
        print(f"  [WARN] tool-cdn not found at {tool_cdn}, skipping tool-cdn checks")

    return checks


# ── Manifest root hash (SPINE-001 body-hash pattern) ─────────────────────────

def compute_manifest_root(all_entries: list) -> str:
    body = canonical_json([
        {"repo": e["repo"], "path": e["path"], "content_hash": e["content_hash"]}
        for e in sorted(all_entries, key=lambda x: (x["repo"], x["path"]))
    ])
    return sha256_str(body)


# ── Receipt (SPINE-001 conformant) ────────────────────────────────────────────

def emit_receipt(manifest_root: str, hash_analysis: dict,
                 semantic_checks: list, total_files: int, repo_counts: dict) -> dict:
    now = datetime.now(timezone.utc).isoformat()

    semantic_summary = {
        "total_checks": sum(len(c.passed) + len(c.failed) for c in semantic_checks),
        "passed": sum(len(c.passed) for c in semantic_checks),
        "failed": sum(len(c.failed) for c in semantic_checks),
        "warnings": sum(len(c.warnings) for c in semantic_checks),
        "check_groups": [
            {
                "name": c.name,
                "passed": len(c.passed),
                "failed": len(c.failed),
                "ok": c.ok,
            }
            for c in semantic_checks
        ]
    }

    payload = {
        "audit_type":     "corpus_integrity_v2",
        "manifest_root":  manifest_root,
        "total_files":    total_files,
        "repos_scanned":  repo_counts,
        "layer1_tamper_candidates": len(hash_analysis["tamper_candidates"]),
        "layer1_exact_duplicates":  len(hash_analysis["exact_duplicates"]),
        "layer2_semantic":          semantic_summary,
    }
    payload_hash = sha256_str(canonical_json(payload))

    body = {
        "author":       "genesis-integrity-harness/2.0",
        "event_type":   "corpus_integrity_audit_v2",
        "payload_hash": payload_hash,
        "timestamp":    now,
    }
    receipt_id = sha256_str(canonical_json(body))

    return {
        "receipt_id":   receipt_id,
        "body":         body,
        "payload":      payload,
        "payload_hash": payload_hash,
    }


# ── Reporting ─────────────────────────────────────────────────────────────────

def print_separator(title: str = ""):
    if title:
        pad = "=" * max(0, 70 - len(title) - 4)
        print(f"  == {title} {pad}")
    else:
        print("=" * 70)


def report_semantic(checks: list):
    print()
    print_separator()
    print("  LAYER 2: SEMANTIC COMPLETENESS CHECKS")
    print_separator()

    total_passed = 0
    total_failed = 0

    for chk in checks:
        status = "PASS" if chk.ok else "FAIL"
        print(f"\n  [{status}] {chk.name}")
        print(f"         {chk.path}")

        if chk.failed:
            for f in chk.failed:
                print(f"    FAIL: {f['check']}")
                if f.get("detail"):
                    print(f"          {f['detail']}")

        if chk.warnings:
            for w in chk.warnings:
                print(f"    WARN: {w['check']}")
                if w.get("detail"):
                    print(f"          {w['detail']}")

        if chk.ok and not chk.warnings:
            print(f"    All {len(chk.passed)} sub-checks passed.")

        total_passed += len(chk.passed)
        total_failed += len(chk.failed)

    print()
    print_separator()
    print(f"  Semantic totals: {total_passed} passed, {total_failed} failed")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("  Genesis Corpus Integrity Harness v2")
    print("  RFC-AUDIT-001 / RFC-013 / RFC-SPINE-001")
    print("  Layer 1: Content-hash tamper detection")
    print("  Layer 2: Semantic completeness / defacement detection")
    print("=" * 70)
    print()

    # ── Layer 1 ───────────────────────────────────────────────────────────────
    all_entries = []
    repo_counts = {}

    for name, root in REPOS.items():
        entries = scan_repo(name, root)
        all_entries.extend(entries)
        repo_counts[name] = len(entries)
        status = "OK" if entries else "NOT FOUND"
        print(f"  Scanned {name}: {len(entries)} files [{status}]")

    print(f"\n  Total: {len(all_entries)} files across {len(REPOS)} repos")

    hash_analysis = analyze_hashes(all_entries)
    manifest_root = compute_manifest_root(all_entries)

    print()
    print_separator()
    print("  LAYER 1: CONTENT-HASH TAMPER CANDIDATES")
    print_separator()

    if not hash_analysis["tamper_candidates"]:
        print("  None.")
    else:
        for tc in sorted(hash_analysis["tamper_candidates"], key=lambda x: x["filename"]):
            print(f"\n  FILENAME: {tc['filename']}")
            for c in sorted(tc["copies"], key=lambda x: x["size_bytes"], reverse=True):
                marker = "(larger)" if c == sorted(tc["copies"],
                         key=lambda x: x["size_bytes"], reverse=True)[0] else "(smaller)"
                print(f"    [{c['repo']}] {c['path']} {marker}")
                print(f"      hash: {c['content_hash']}")
                print(f"      size: {c['size_bytes']} bytes")

    # ── Layer 2 ───────────────────────────────────────────────────────────────
    semantic_checks = run_semantic_checks(REPOS)
    report_semantic(semantic_checks)

    # ── Receipt ───────────────────────────────────────────────────────────────
    receipt = emit_receipt(manifest_root, hash_analysis, semantic_checks,
                           len(all_entries), repo_counts)

    print()
    print_separator()
    print("  MANIFEST ROOT & RECEIPT")
    print_separator()
    print(f"\n  manifest_root: {manifest_root}")
    print(f"  receipt_id:    {receipt['receipt_id']}")
    print(f"  payload_hash:  {receipt['payload_hash']}")
    print(f"  timestamp:     {receipt['body']['timestamp']}")

    # Write manifest
    output = {
        "receipt":       receipt,
        "manifest_root": manifest_root,
        "layer1":        hash_analysis,
        "layer2":        [
            {
                "name":     c.name,
                "path":     c.path,
                "ok":       c.ok,
                "passed":   c.passed,
                "failed":   c.failed,
                "warnings": c.warnings,
            }
            for c in semantic_checks
        ],
        "entries":       all_entries,
    }
    out_path = "/home/claude/corpus-integrity-manifest-v2.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, sort_keys=True)

    print(f"\n  Full manifest written: {out_path}")
    print(f"  ({len(all_entries)} entries, {os.path.getsize(out_path)//1024}KB)")

    # ── Verdict ───────────────────────────────────────────────────────────────
    n_tamper = len(hash_analysis["tamper_candidates"])
    n_semantic_fail = sum(len(c.failed) for c in semantic_checks)
    total_fail = n_tamper + n_semantic_fail

    print()
    print("=" * 70)
    if total_fail == 0:
        print("  VERDICT: CLEAN")
        print("  Layer 1: No tamper candidates | Layer 2: All semantic checks passed")
    else:
        if n_tamper > 0:
            print(f"  VERDICT: TAMPER DETECTED")
            print(f"  Layer 1: {n_tamper} hash collision(s) with divergence")
        if n_semantic_fail > 0:
            verdict = "VERDICT: DEFACEMENT DETECTED" if n_tamper == 0 else ""
            if verdict:
                print(f"  {verdict}")
            print(f"  Layer 2: {n_semantic_fail} semantic check(s) FAILED")
            print("           Required governance fields or conservation law content absent")
    print("=" * 70)
    print()

    return 1 if total_fail > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
