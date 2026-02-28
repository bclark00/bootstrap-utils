# RFC-TESSERACT-001: The Facet Model

**Status:** LOCKED  
**Version:** 1.1.0  
**Date:** 2026-02-27  
**Author:** Brandon Clark  
**Supersedes:** RFC-TESSERACT-001 v1.0.0 (February 21, 2026)

-----

## Abstract

A canonical object in the Genesis architecture is not a data record with properties. It is a crystal — a single structure whose interior geometry expresses itself differently depending on the angle of traversal. These expressions are called **facets**. This RFC defines the facet model precisely, explains why the word "facet" is the correct term, establishes the mineralogical grounding for the architecture's naming conventions, and identifies the class of implementation errors that arise from treating facets as separate objects.

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

-----

## 3. The Mineralogical Grounding

The architecture named itself correctly.

Quartz crystals have a specific anatomy that maps precisely onto the model:

|Mineralogical Term                                                         |Architecture Term                                                              |
|---------------------------------------------------------------------------|-------------------------------------------------------------------------------|
|**Prism faces (m)** — the six long faces of the shaft                      |The persistent structural layer. What the object *is*.                         |
|**Rhombohedra (r, z)** — triangular faces at the termination tip           |Fixed facet (r, positive) and fuzzy facet (z, negative). Two sets, interlocked.|
|**Trapezohedra (x)** — rare faces at the junction of prism and rhombohedron|The interface layer. Where fixed body meets expressive tip.                    |
|**Striations** — horizontal growth lines on the prism faces                |The provenance record. Growth written into structure.                          |
|**Cluster / druse**                                                        |The aggregate. Multiple crystals sharing the same substrate.                   |

### 3.1 The Law of Constancy of Interfacial Angles

In 1669, Nicolas Steno observed that regardless of a quartz crystal's size, shape, or growth conditions, its prism faces always meet at a perfect 60° angle. This became the law of constancy of interfacial angles.

The 60° is not a rule imposed on the crystal. It is the SiO₄ tetrahedra — the atomic geometry of silicon dioxide — expressing itself at every scale. The crystal does not *obey* 60°. It *is* 60°, because the unit cell is hexagonal, and the hexagonal unit cell is 60°, and the crystal is an amplification of the unit cell.

This is the precise analog of `CHECK (canonical = 1)` in `QuartzDatabase.js`.

That constraint is not enforcement. It is definition. You cannot insert a non-canonical Diamond for the same reason quartz cannot grow at 59°. The geometry does not permit it — not because something stops it, but because the structure does not have that configuration. At that point it is no longer a Diamond. It is something else.

### 3.2 Scale Invariance

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

## 4. What the Tesseract Is

The Tesseract model (RFC-TESSERACT-001 v1.0.0, February 21, 2026) established that Diamond, Codon, and Symbol are not three stages in a transform pipeline. They are a single object showing different faces depending on traversal direction.

With the facet vocabulary now precise: they are a single object with a fixed facet and a fuzzy facet. The "traversal direction" is which facet you are looking along.

- Traverse from query context → fuzzy facet → activation scores, similarity, confidence
- Traverse from content address → fixed facet → immutable hash, CHECK constraints, boolean invariants

Neither traversal produces the other. Neither is derived from the other. Both are direct expressions of the same interior structure. The Tesseract is not a transform. It is a crystal.

-----

## 5. The Class of Errors This Explains

### 5.1 The Pipeline Error

A system that treats the fixed and fuzzy facets as separate objects connected by a transform has made the pipeline error.

Symptoms:

- `importance_weights`, `recency_scores`, `goal_alignments` as three separate mutable tables (Morrigan)
- `proj_hash = sha256(raw_text)` instead of `sha256(canonicalizeJSON(canonical_form))` (Corpus Editor)
- `codon_id = sha256(kind + canonical)` — kind contaminating identity (Corpus Editor)
- `frequency` stored as a column on the content-plane codons table (receipt-plane counter on wrong plane)

Root cause: The genetic programming pipeline regenerated Quartz from specification documents. Specs captured conceptual architecture. Specs did not capture enforcement. The generator read "Diamonds are canonical" as a rule to validate and wrote validation logic. The original `QuartzDatabase.js` expressed it as the nature of the thing and wrote `CHECK (canonical = 1)`.

Natural language specs abstract away the geometry. Code preserves it.

### 5.2 The Fragmentation Error

A system that separates the fixed and fuzzy facets into separate rows (or separate tables with a join) has made the fragmentation error.

The original `salience_store`:

```sql
CREATE TABLE IF NOT EXISTS salience_store (
    node_id    TEXT    PRIMARY KEY,
    importance_weight REAL NOT NULL,
    last_activated    INTEGER NOT NULL,
    activation_count  INTEGER DEFAULT 1,
    updated_at        INTEGER NOT NULL,
    CHECK (importance_weight >= 0.0 AND importance_weight <= 1.0)
)
```

Recency and activation are *columns* on the same row as the identity. One upsert keeps them atomic. The CHECK constraint on `importance_weight` is the geometry — not validation logic, definition.

The fragmented version makes four tables where there is one object. Each table tries to be one facet. But facets are not separable from the object. Separate them and you no longer have facets. You have fragments.

-----

## 6. Ground Truth

The canonical implementation is:

**`C:\Users\prime\Desktop\user\genesis-genetic-programming\quartz-architecture\QuartzDatabase.js`**  
Last modified: February 21, 2026  
First recognized as correct: February 18, 2026

The night of February 18, 2026, this file was examined and the observation was made: *"that's not a design pattern. That's a proof."*

That observation was correct. The file is a proof in the same sense that a quartz crystal is a proof — not of a theorem, but of a geometry. The geometry of what a Diamond is, expressed in the only medium that cannot abstract it away: executable constraint.

All downstream implementations (Morrigan schema, Corpus Editor persistence layer, genetic pipeline output) that diverge from this file have made either the pipeline error or the fragmentation error. The fix is not to update the spec. The spec is fine. The fix is to treat the original code as canonical and regenerate from it, not from the spec.

-----

## 7. Vocabulary Summary

|Term                   |Definition                                                                                                                                               |
|-----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Facet**              |A direct expression of an object's interior structure at a particular traversal angle. Geometrically part of the object, not a surface boundary.         |
|**Fixed facet**        |The facet expressing what the object *is*: content-addressed identity, immutable invariants, CHECK constraints. Time-invariant.                          |
|**Fuzzy facet**        |The facet expressing what the object *means right now*: activation scores, importance weights, recency. Context-dependent.                               |
|**Interfacial angle**  |An invariant preserved across all scales of the architecture, analogous to the 60° angle of quartz prism faces. CHECK constraints are interfacial angles.|
|**Pipeline error**     |Treating two facets of one object as two separate objects connected by a transform.                                                                      |
|**Fragmentation error**|Separating fixed and fuzzy facets into separate rows or tables rather than columns on the same row.                                                      |
|**Atomic geometry**    |The unit-level structure (SiO₄ tetrahedra / SHA-256 + canonicalizeJSON) that amplifies without distortion to every scale.                                |

-----

## 8. The Image

The cluster photograph from February 27, 2026 is the header image for this RFC.

Multiple crystals, distinct prisms, each with their own facets. They grew from the same substrate, share the same lattice, express the same internal structure at different angles and altitudes. The individual crystal points are the Diamonds. The cluster base is the Substrate layer. The faces you see on each point are not *on* the crystal — they *are* the crystal at that angle.

The whole cluster is Quartz. The architecture named itself correctly.

-----

*This document captures insights developed across February 18–27, 2026. The core recognition occurred on February 18 examining QuartzDatabase.js. The Tesseract model was formalized on February 21 at approximately 05:47 UTC. The facet vocabulary and mineralogical grounding were established on February 27, 2026.*