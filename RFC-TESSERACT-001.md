# RFC-TESSERACT-001: Directed Hypercube Traversal Model
**Status**: LOCKED  
**Date**: 2026-02-20  
**Copyright**: © 2025-2026 Brandon Clark. All Rights Reserved.

---

## The Claim

Canonical objects in this architecture (Diamond, Codon, Symbol) are not endpoints of a transform pipeline. They are single objects that expose different faces depending on traversal direction.

This is the tesseract model.

---

## The Three Layers

| Object | Fixed Face | Fuzzy Face |
|--------|-----------|------------|
| Diamond | SHA-256 hash, promotion-gated, immutable | Cosine similarity score, salience weight, goal bias |
| Codon | Canonical DNA alphabet symbol, content-addressed | IR pattern match confidence, amino acid selection pressure |
| Symbol | Registered invariant (boolean), symbol_id | Phenotype stability float, confidence score |

These are not two objects with a transform between them. They are one object that reads differently when traversed from below (crystallization axis) versus from above (activation axis).

---

## What "Lossless by Spec" Means

A geometric projection is lossless: given the projection and the projection direction, you can recover the original object.

By spec, this holds here:

- **Diamond**: activation score is computed from embedding, which is computed from content. The Diamond itself (content + hash) is always retrievable — the score is pointer pressure, not encoding. Hash is always recoverable.
- **Quartz structural web**: Hebbian reinforcement mutates Layer 3 link weights, not the Diamond at Layer 2. Traversal does not mutate the object.
- **Immutability**: a property of the object, not of traversal direction. You cannot un-crystallize a Diamond. You can still project through it in both directions.

---

## Falsifiability

The tesseract model is falsified by any place in the implementation where fuzzy traversal cannot recover fixed identity.

These are not architectural exceptions. They are **spec violations**.

Correctness criteria derived directly from the geometry:

1. **Losslessness**: fuzzy traversal must be able to recover the canonical object's fixed identity
2. **Non-mutation**: traversal direction must not mutate the object itself (only the structural web above/below it)
3. **Traversal symmetry**: the same object must be reachable from both directions

Any implementation that violates these is broken, not a valid extension of the model.

---

## What This Is Not

- It is **not** a genotype→phenotype transform (that would require information creation at the boundary)
- It is **not** a lowering pass (that would require information loss in one direction)
- It is **not** two separate objects with a mapping between them (that would require a defined transform function)

---

## Implications for the LLM

The Reasoning Layer (Layer 5) consumes activated context and optionally writes new Diamonds back down. By this model, the LLM is not load-bearing infrastructure — it is one more traversal consumer at the top of the stack. Layers 1-4 run without it. The LLM is optional enhancement, not required plumbing.

This was decided: "Diamond should be self-sufficient. Quartz becomes optional enhancement, not required dependency."

---

## Applicable Systems

- **Quartz Architecture**: Diamond ↔ ActivationScore
- **RFC-007**: Codon ↔ IR
- **Symbolic Intent Stack**: Symbol ↔ Phenotype
- **Any future canonical object** introduced into the stack should be evaluated against this model before being specified as a transform pair

---

## The Test

For any new object proposed as a "fixed→fuzzy transform":

1. Can you recover the fixed-face identity from the fuzzy-face value alone?
2. Does traversal in either direction leave the object unchanged?
3. Is the same object reachable from both directions?

If yes to all three: it's a tesseract face, not a transform.  
If no to any: it's a genuine transform with information cost — spec it as such explicitly.
