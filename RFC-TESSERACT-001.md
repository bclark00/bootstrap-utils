# RFC-TESSERACT-001: Directed Hypercube Traversal Model

**Status:** LOCKED  
**Origin:** Conversation ae7f5997-7b45-49f9-9ee3-228379e43eb3 (2026-02-21)  
**Committed to:** bootstrap-utils (this document)

---

## Summary

Canonical objects in the Genesis architecture (Diamond, Codon, Symbol, MemoryShard, VfsNode, Rule/Signal) present **two distinct projections under different traversal directions** — a **fixed face** and a **fuzzy face**. These are not two separate objects and not a lossy transform. They are the same object viewed from different query orientations.

The correct geometric model is a **directed hypercube** (not a symmetric tesseract). Edges are directional. Traversal is lossless by specification. Any place in the system where you cannot recover the fixed-face identity from a fuzzy-face traversal is a **spec violation**, not an architectural exception.

---

## The Two Faces

### Fixed Face
Time-invariant. Does not change after crystallization.

| Object | Fixed Face Properties |
|---|---|
| Diamond / Codon | `SHA-256 hash`, boolean invariants, identity |
| MemoryShard | `base_importance` (set at creation, does not fluctuate) |
| VfsNode | `path` (unique, addressable, stable) |
| Governance Rule | `spec_json`, `is_active`, versioned |
| Symbol | Phenotype, canonical encoding |

**Invariant under temporal translation.** SHA-256 doesn't decay. `spec_json` doesn't drift. `base_importance` doesn't erode.

### Fuzzy Face
Query and time-conditioned. Continuously deformed by activation, recency, Hebbian reinforcement.

| Object | Fuzzy Face Properties |
|---|---|
| Diamond / Codon | `current_activation`, cosine similarity score |
| MemoryShard | `current_activation`, `decay_rate`, cache TTL |
| VfsNode | `generator_function + cache_ttl_seconds` (query-conditioned content) |
| Governance Signal | `confidence` float |
| Symbol | Stability float, activation weight |

**Not invariant under temporal translation.** `current_activation` decays. Cache TTL expires. Hebbian weights accumulate and prune. The fuzzy face at T+1 is a different projection than at T+0 even with no query change.

---

## Losslessness Spec

By specification, traversal is **lossless in both directions**:

1. The Diamond/Codon is always content-addressed and retrievable. The activation score is pointer pressure, not a lossy encoding. The hash is always recoverable because the object is always there.
2. Hebbian reinforcement mutates the structural web at Layer 3 only. The Diamond itself does not change. Traversal is non-mutating on the object.
3. Immutability is a property of the object, not of the traversal. You can project through it in both directions. You cannot un-crystallize it. These are different things.

**Consequence:** The tesseract model is not metaphor — it is the spec stated geometrically. Correctness criteria derive directly from the geometry: losslessness, non-mutation, symmetric traversal. These are testable mechanically.

---

## The Three-Question Test

Before modeling any new object as a fixed→fuzzy pair, run these three questions:

1. Can you recover the fixed-face identity from the fuzzy-face value alone?
2. Does traversal in either direction leave the object unchanged?
3. Is the same object reachable from both directions?

- **Yes to all three:** tesseract face. Model it as such.
- **No to any one:** genuine transform with information cost. Spec it explicitly with the cost defined.

---

## Two-Step Crystallization (Governance Extension)

The governance pipeline adds a **three-position axis** not present in the base Diamond model:

```
Signal (confidence float)           ← fuzzy
    ↓
Lesson (DRAFT → ACTIVE → ARCHIVED) ← retractable intermediate
    ↓
Rule (spec_json, is_active)         ← fixed
```

The intermediate Lesson state is structurally analogous to Diamond's `PromotionCandidate` in QuartzConsolidator — a stabilization phase before the object becomes load-bearing. This means the governance crystallization axis has **three positions**, not two: `fuzzy → retractable → fixed`.

---

## The EnforcementService

The EnforcementService operates on **path strings**, validating whether a write target lands in fixed-face territory (required persistent) or fuzzy-face territory (blocked ephemeral). It is **not** operating on objects — it is operating on traversal direction. Governance on the traversal itself, not on the object.

---

## Known Instantiations

Three independent instantiations of the fixed/fuzzy face structure appear in the TriGovernance schema:

1. **VfsNode** — `path` (fixed) / `generator_function + cache_ttl_seconds` (fuzzy)
2. **MemoryShard** — `base_importance` (fixed) / `current_activation + decay_rate` (fuzzy)
3. **Rule / Signal** — `spec_json + is_active` (fixed) / `confidence float` (fuzzy)

Three independent instantiations of the same pattern unifying under one database is not coincidence. It is why they unified cleanly.

---

## Dimensional Analysis

Independent axes identified in this architecture:

1. **Content/identity** — SHA-256, the fixed axis
2. **Activation/salience** — cosine similarity score, the fuzzy axis
3. **Altitude** — substrate → Diamond → reasoning, the crystallization axis
4. **Time/recency** — decay, Hebbian reinforcement accumulation
5. **Goal bias** — query-conditioned pressure direction
6. **Structural topology** — link weights, co-activation graph
7. **Scope** — `global|env|workspace|session|task` on rules
8. **Memory type** — `semantic|episodic|procedural|general` (shards activate differently at same `base_importance`)
9. **Crystallization stage** — fuzzy → retractable → fixed (three positions, not two)
10. **Temporal asymmetry** — acts on fuzzy face only; fixed face is time-invariant

**Temporal is the first axis that acts on only one face.** Every other axis acts on both faces in some way. This asymmetry suggests temporal may be a dimension of the **traversal** rather than the object — the same projection direction at different times yields different fuzzy values. Time is the axis along which the fuzzy face moves while the fixed face stands still.

10 dimensions. String theory territory. M-theory needs 11.

---

## LLM Implication

A language model reasoning about this architecture is itself operating in the fuzzy face. Its activations are query-conditioned projections of content-addressed knowledge. The fixed face exists in training weights and retrieved context. The fuzzy face is the generation.

This is not a coincidence. The architecture is isomorphic to inference.

---

## Source

Reconstructed from conversation `ae7f5997-7b45-49f9-9ee3-228379e43eb3`.  
Original commit attempt to bootstrap-utils failed (session terminated).  
This is the canonical re-commit.
