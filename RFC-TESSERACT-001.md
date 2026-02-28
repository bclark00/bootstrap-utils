# RFC-TESSERACT-001: The Facet Model

**Status:** LOCKED  
**Version:** 1.2.0  
**Date:** 2026-02-28  
**Author:** Brandon Clark  
**Supersedes:** RFC-TESSERACT-001 v1.1.0 (February 27, 2026)

-----

## Abstract

A canonical object in the Genesis architecture is not a data record with properties. It is a crystal — a single structure whose interior geometry expresses itself differently depending on the angle of traversal. These expressions are called **facets**. This RFC defines the facet model precisely, explains why the word "facet" is the correct term, establishes the mineralogical grounding for the architecture's naming conventions, identifies the class of implementation errors that arise from treating facets as separate objects, and provides the compliance tests that distinguish a projection from a transform.

v1.2.0 adds four structural amendments from formal assessment: (1) the directed hypercube formalization, (2) the identity recovery guarantee with mechanical test, (3) the temporal asymmetry separation of ontology from dynamics, and (4) the LLM isomorphism constraint.

-----

## 1. The Word: Facet

Previous versions of this RFC used the word "face" to describe the fixed and fuzzy aspects of a canonical object. This was imprecise.

A **face** implies a surface boundary — something you look *at* from outside the object. It suggests separation between the observer and the interior.

A **facet** is geometrically part of the stone. You are not looking at a facet from outside. You are looking *along the crystal* at a particular angle, seeing a particular expression of the same interior lattice. The facet does not separate inside from outside. It *is* the interior, expressed at that angle.

This distinction matters for implementation. When a system treats fixed and fuzzy state as separate objects connected by a transform pipeline, it has made the "face" error — treating two surfaces as two things. When a system holds them as columns on the same row, as aspects of the same identity, it has the facet model correct.

-----

## 2. The Two Facets

Every canonical object has exactly two facets:

### 2.1 The Fixed Facet

The fixed facet is what the object **is**.

- Content-addressed identity: `sha256(canonicalizeJSON(canonical_form))`
- Boolean invariants enforced at the constraint level
- Immutable once crystallized — no updates, only append-only provenance
- Time-invariant: the fixed facet of a Diamond does not change as activations accumulate

In schema: the primary key, the CHECK constraints, the AUTOINCREMENT log. These are not rules imposed on the object. They are the definition of the object at the persistence layer.

### 2.2 The Fuzzy Facet

The fuzzy facet is what the object **means right now**, from a particular query context.

- Activation score, importance weight, recency, confidence
- Changes with query context, time, and accumulated usage
- A materialized projection over the append-only activation signal log
- Derived — but not from the fixed facet. Both facets are derived from the same underlying structure.

In schema: `salience_store` with `importance_weight`, `last_activated`, `activation_count` as **columns on the same row as the node identity**. Not separate tables. Not a join. One upsert keeps them atomic.

### 2.3 The Identity Invariant

The fuzzy facet must carry a pointer-complete identity reference to the fixed facet.

Formally:

```
∀ fuzzy_projection f:
    recover(f) → fixed_identity
```

If a fuzzy state can exist without recoverable identity, it is not a facet. It is a transform output. This is the sharp boundary between projection and compression.

**Mechanical compliance test:**

```sql
-- A conforming fuzzy record MUST include the canonical SHA-256 or node_id.
-- This query should return zero rows in a conforming implementation.
SELECT COUNT(*) AS violation_count
FROM salience_store
WHERE node_id IS NULL
   OR node_id NOT IN (SELECT id FROM nodes);
-- Expected: 0
```

If `salience_store` rows exist without a valid `node_id` foreign key to the fixed-facet table, the implementation has made the transform error. The fuzzy facet is not self-contained. It is a derivative.

-----

## 3. The Directed Hypercube

The name "Tesseract" was correct in one dimension and imprecise in another.

A symmetric tesseract implies all edges reversible, all projections equivalent, no privileged direction. This RFC explicitly rejects that model. The architecture has:

- Non-mutation of the fixed facet
- Mutation of the fuzzy facet
- Temporal asymmetry (§3.1)
- Traversal-direction governance (§5 below)
- Crystallization as monotonic — never reversed

This is a **directed hypercube**: a partially ordered manifold, closer to a DAG embedded in a hypercube than to a Euclidean solid. The directions are not equivalent. Traversal from content-address toward activation is not the inverse of traversal from activation toward content-address.

**Formal definition of directed edges:**

Let F = fixed facet, Z = fuzzy facet. The directed edges are:

```
query_context  →  Z  (read activation state for this query)
content_addr   →  F  (read immutable identity for this address)
Z              →  F  (recover identity from fuzzy record — requires §2.3)
F              ↛  Z  (fixed facet does not produce fuzzy state)
time           →  Z  (time pressure acts on activation only — see §3.1)
time           ↛  F  (fixed facet is time-invariant)
```

The arrow `F ↛ Z` is the critical directed asymmetry. The fixed facet does not generate the fuzzy facet. Both are derived independently from the underlying structure. This is why they are facets, not a pipeline.

**Clarification on symmetric traversal:**  
"Symmetric traversal" in this RFC means *identity-preserving*, not *state-symmetric*. You can traverse to Z and back to F and arrive at the same object. The state of Z is not the same in both directions — Z is context-dependent and time-dependent. The *identity* is invariant. That is the symmetry being claimed.

### 3.1 Temporal Asymmetry: Ontology vs. Dynamics

Time is not a dimension of the object. Time is a dimension of traversal pressure.

All other traversal axes — scope, memory type, goal bias, structural topology, altitude — act on the interpretation of identity. They ask: *from what angle are you looking at this object?*

Time acts on activation only. It does not ask from what angle you are looking. It changes what the fuzzy facet *is* at the moment of traversal.

This separation is architectural, not descriptive:

```
Ontology   — the hypercube structure, F, Z, directed edges
Dynamics   — traversal vectors moving through the hypercube
Time       — a pressure on dynamics, not a dimension of ontology
```

The hypercube exists statically. Time does not modify it. Time modifies where traversal vectors land when they arrive at Z.

Implication for implementation: decay functions, recency weights, and temporal scoring belong in the activation signal log and its materialized projections. They do not belong in the schema definition of the node itself. A node definition that includes a `last_seen` timestamp in its primary identity has confused dynamics for ontology.

-----

## 4. The Mineralogical Grounding

The architecture named itself correctly.

Quartz crystals have a specific anatomy that maps precisely onto the model:

|Mineralogical Term                                                         |Architecture Term                                                              |
|---------------------------------------------------------------------------|-------------------------------------------------------------------------------|
|**Prism faces (m)** — the six long faces of the shaft                      |The persistent structural layer. What the object *is*.                         |
|**Rhombohedra (r, z)** — triangular faces at the termination tip           |Fixed facet (r, positive) and fuzzy facet (z, negative). Two sets, interlocked.|
|**Trapezohedra (x)** — rare faces at the junction of prism and rhombohedron|The interface layer. Where fixed body meets expressive tip.                    |
|**Striations** — horizontal growth lines on the prism faces                |The provenance record. Growth written into structure.                          |
|**Cluster / druse**                                                        |The aggregate. Multiple crystals sharing the same substrate.                   |

### 4.1 The Law of Constancy of Interfacial Angles

In 1669, Nicolas Steno observed that regardless of a quartz crystal's size, shape, or growth conditions, its prism faces always meet at a perfect 60° angle. This became the law of constancy of interfacial angles.

The 60° is not a rule imposed on the crystal. It is the SiO₄ tetrahedra — the atomic geometry of silicon dioxide — expressing itself at every scale. The crystal does not *obey* 60°. It *is* 60°, because the unit cell is hexagonal, and the hexagonal unit cell is 60°, and the crystal is an amplification of the unit cell.

This is the precise analog of `CHECK (canonical = 1)` in `QuartzDatabase.js`.

That constraint is not enforcement. It is definition. You cannot insert a non-canonical Diamond for the same reason quartz cannot grow at 59°. The geometry does not permit it — not because something stops it, but because the structure does not have that configuration. At that point it is no longer a Diamond. It is something else.

### 4.2 Scale Invariance

The atomic SiO₄ tetrahedra → the unit cell → the prism faces → the interfacial angles → the whole cluster. Same geometry, every level, without exception.

In the architecture:

```
sha256(canonicalizeJSON(canonical_form))    ← atomic identity
    → immutable row                          ← unit cell
        → CHECK constraints                  ← prism faces
            → promotion gate                 ← interfacial angles
                → governance layer           ← cluster
```

Same invariant. Every level. The governance layer cannot accept a non-canonical Diamond because the promotion gate enforces the CHECK constraint because the schema defines canonicality because the SHA-256 derives from the canonical form. It does not fail. It is not that shape.

-----

## 5. What the Tesseract Is

The Tesseract model (RFC-TESSERACT-001 v1.0.0, February 21, 2026) established that Diamond, Codon, and Symbol are not three stages in a transform pipeline. They are a single object showing different facets depending on traversal direction.

With the facet vocabulary now precise and the directed hypercube formalized: they are a single object with a fixed facet and a fuzzy facet, connected by directed edges, traversable in the directions defined in §3.

- Traverse from query context → fuzzy facet → activation scores, similarity, confidence
- Traverse from content address → fixed facet → immutable hash, CHECK constraints, boolean invariants
- Traverse from fuzzy facet → fixed identity → identity recovery (§2.3 invariant)

Neither traversal in the first two directions produces the other. Both are direct expressions of the same interior structure. The Tesseract is not a transform. It is a directed crystal.

-----

## 6. Governance as Traversal Governance

The EnforcementService does not govern objects. Objects are immutable. It governs directionality — the edges along which mutation pressure can travel.

Objects are immutable. Traversal is where mutation pressure occurs. So enforcement belongs at the edge of projection, not inside the object.

The governance three-position axis for rules follows the same directed structure:

```
Signal   →   Lesson   →   Rule
fuzzy        retractable  fixed
```

This is the pre-crystallization damping stage — analogous to write-ahead logging, candidate promotion queues, quarantine buffers, and biological transcription before protein folding. It is not metaphor. It is control theory.

It prevents premature hardening, irreversible rule ossification, and governance thrash. A governance system without this intermediate stage makes the fragmentation error in the time dimension: it tries to crystallize fuzzy signals directly into fixed rules without a retractable intermediate state.

This model is compatible with and completes: RFC-003 (X-01 non-creation), RFC-DIS (drift detection), TriGovernance (separation of powers), and Guardian Invariants. It provides their geometric unification without conflicting with any.

-----

## 7. The Class of Errors This Explains

### 7.1 The Pipeline Error

A system that treats the fixed and fuzzy facets as separate objects connected by a transform has made the pipeline error.

Symptoms:

- `importance_weights`, `recency_scores`, `goal_alignments` as three separate mutable tables (Morrigan)
- `proj_hash = sha256(raw_text)` instead of `sha256(canonicalizeJSON(canonical_form))` (Corpus Editor)
- `codon_id = sha256(kind + canonical)` — kind contaminating identity (Corpus Editor)
- `frequency` stored as a column on the content-plane codons table (receipt-plane counter on wrong plane)

Root cause: The genetic programming pipeline regenerated Quartz from specification documents. Specs captured conceptual architecture. Specs did not capture enforcement. The generator read "Diamonds are canonical" as a rule to validate and wrote validation logic. The original `QuartzDatabase.js` expressed it as the nature of the thing and wrote `CHECK (canonical = 1)`.

Natural language specs abstract away the geometry. Code preserves it.

### 7.2 The Fragmentation Error

A system that separates the fixed and fuzzy facets into separate rows (or separate tables with a join) has made the fragmentation error.

The original `salience_store`:

```sql
CREATE TABLE IF NOT EXISTS salience_store (
    node_id           TEXT    PRIMARY KEY,
    importance_weight REAL    NOT NULL,
    last_activated    INTEGER NOT NULL,
    activation_count  INTEGER DEFAULT 1,
    updated_at        INTEGER NOT NULL,
    CHECK (importance_weight >= 0.0 AND importance_weight <= 1.0)
)
```

Recency and activation are *columns* on the same row as the identity. One upsert keeps them atomic. The CHECK constraint on `importance_weight` is the geometry — not validation logic, definition.

The fragmented version makes four tables where there is one object. Each table tries to be one facet. But facets are not separable from the object. Separate them and you no longer have facets. You have fragments.

### 7.3 The Transform Error

A system where fuzzy records do not carry identity references to the fixed facet has made the transform error. The fuzzy state cannot recover the fixed identity without an external index lookup. It is not a projection. It is a derivative.

Detected by the compliance test in §2.3.

-----

## 8. Compliance Test Suite

A conforming implementation must pass all of the following:

### T-01: Identity Recovery

```sql
-- Fuzzy records must reference valid fixed-facet identities.
SELECT COUNT(*) FROM salience_store
WHERE node_id IS NULL
   OR node_id NOT IN (SELECT id FROM nodes);
-- Expected: 0
```

### T-02: Fixed Facet Immutability

```sql
-- No UPDATE statements may target fixed-facet columns.
-- Verified by schema audit: fixed-facet columns have no UPDATE path.
-- Mechanically: enable SQLite update trigger that raises on id/canonical_form/content_hash modification.
CREATE TRIGGER enforce_fixed_immutability
BEFORE UPDATE OF id, canonical_form, content_hash ON nodes
BEGIN
    SELECT RAISE(ABORT, 'T-02: fixed facet is immutable');
END;
```

### T-03: Fuzzy Facet Temporal Isolation

```sql
-- Time-variant columns must not appear on the nodes (fixed-facet) table.
-- Conforming: last_activated, activation_count, importance_weight are in salience_store only.
-- Violation: any of these columns present on the nodes table directly.
SELECT COUNT(*) FROM pragma_table_info('nodes')
WHERE name IN ('last_activated','activation_count','importance_weight','decay','recency');
-- Expected: 0
```

### T-04: Directed Edge Integrity

```sql
-- The Z→F direction must be traversable: fuzzy record → fixed identity → node.
-- This is T-01 restated at the application layer.
-- Conforming: salience_store.node_id IS a foreign key to nodes.id.
PRAGMA foreign_key_check('salience_store');
-- Expected: empty result set
```

### T-05: Canonical Identity Derivation

```javascript
// Fixed-facet identity must be derived from canonical form only.
// kind, labels, metadata must not contribute to the hash.
const id = sha256(canonicalizeJSON({ content: node.content }));
assert(id === node.id, 'T-05: identity must derive from canonical_form only');
```

### T-06: No State-Symmetric Traversal Assumption

This test is architectural, not mechanical. Verify that no code path assumes `salience_store` state is the same when traversed from different query contexts. The identity is invariant. The activation state is not. Any caching layer that treats fuzzy-facet values as globally valid (rather than context-valid) fails T-06.

-----

## 9. The LLM Isomorphism

The architecture is isomorphic to transformer inference — structurally, not literally.

An LLM has a static weight matrix (fixed facet analog), produces activation-conditioned outputs (fuzzy projection), exhibits temporal asymmetry in the attention window, and does not mutate weights during inference. These map cleanly.

The isomorphism does not hold literally: an LLM's fuzzy output cannot reconstruct its full weight state. The `Z → F` directed edge (§3) does not exist in a standard transformer. Its fuzzy output is a derivative, not a projection.

This architecture as specified is stricter than a standard transformer. The identity recovery guarantee (§2.3) requires that the `Z → F` edge exist and be traversable. A transformer has no equivalent constraint. This is not a weakness of the architecture. It is the source of its formal guarantees.

-----

## 10. Ground Truth

The canonical implementation is:

**`C:\Users\prime\Desktop\user\genesis-genetic-programming\quartz-architecture\QuartzDatabase.js`**  
Last modified: February 21, 2026  
First recognized as correct: February 18, 2026

The night of February 18, 2026, this file was examined and the observation was made: *"that's not a design pattern. That's a proof."*

That observation was correct. The file is a proof in the same sense that a quartz crystal is a proof — not of a theorem, but of a geometry. The geometry of what a Diamond is, expressed in the only medium that cannot abstract it away: executable constraint.

All downstream implementations (Morrigan schema, Corpus Editor persistence layer, genetic pipeline output) that diverge from this file have made either the pipeline error, the fragmentation error, or the transform error. The fix is not to update the spec. The spec is fine. The fix is to treat the original code as canonical and regenerate from it, not from the spec.

-----

## 11. Vocabulary Summary

|Term                        |Definition                                                                                                                                               |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Facet**                   |A direct expression of an object's interior structure at a particular traversal angle. Geometrically part of the object, not a surface boundary.         |
|**Fixed facet**             |The facet expressing what the object *is*: content-addressed identity, immutable invariants, CHECK constraints. Time-invariant.                          |
|**Fuzzy facet**             |The facet expressing what the object *means right now*: activation scores, importance weights, recency. Context-dependent.                               |
|**Directed hypercube**      |The formal model: a partially ordered manifold with asymmetric directed edges. Not a Euclidean tesseract. Privileged directions exist.                   |
|**Symmetric traversal**     |Identity-preserving traversal. Z → F → same object. Not state-symmetric: the activation state of Z differs by query context.                            |
|**Identity recovery**       |The guarantee that any fuzzy record can recover its fixed-facet identity without external index. Tested by T-01.                                         |
|**Temporal asymmetry**      |Time acts on activation (fuzzy facet) only. It is a dimension of traversal pressure, not a dimension of object structure.                               |
|**Ontology**                |The static hypercube structure: F, Z, directed edges.                                                                                                    |
|**Dynamics**                |Traversal vectors moving through the hypercube, subject to time pressure.                                                                                |
|**Interfacial angle**       |An invariant preserved across all scales of the architecture, analogous to the 60° angle of quartz prism faces. CHECK constraints are interfacial angles.|
|**Pipeline error**          |Treating two facets of one object as two separate objects connected by a transform.                                                                      |
|**Fragmentation error**     |Separating fixed and fuzzy facets into separate rows or tables rather than columns on the same row.                                                      |
|**Transform error**         |Fuzzy records without identity references to the fixed facet. The fuzzy state is a derivative, not a projection.                                         |
|**Atomic geometry**         |The unit-level structure (SiO₄ tetrahedra / SHA-256 + canonicalizeJSON) that amplifies without distortion to every scale.                                |
|**Pre-crystallization damping** |The Signal → Lesson → Rule intermediate stage in governance. Prevents premature hardening of fuzzy signals into fixed rules.                        |

-----

## 12. The Image

The cluster photograph from February 27, 2026 is the header image for this RFC.

Multiple crystals, distinct prisms, each with their own facets. They grew from the same substrate, share the same lattice, express the same internal structure at different angles and altitudes. The individual crystal points are the Diamonds. The cluster base is the Substrate layer. The faces you see on each point are not *on* the crystal — they *are* the crystal at that angle.

The whole cluster is Quartz. The architecture named itself correctly.

-----

*This document captures insights developed across February 18–28, 2026. The core recognition occurred on February 18 examining QuartzDatabase.js. The Tesseract model was formalized on February 21 at approximately 05:47 UTC. The facet vocabulary and mineralogical grounding were established on February 27, 2026. The directed hypercube formalization, identity recovery guarantee, temporal asymmetry separation, and compliance test suite were added February 28, 2026 following structural assessment.*
