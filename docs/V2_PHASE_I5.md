# Phase I.5 — Resolution hardening

Audit written before the schema was touched, per the phase brief.

Phase I built the machine that fills the tables. Before filling them with
hundreds of real Israeli records, the thing that reads them has to be able to
recognise a product. Today it cannot: `MacBook Air M4` does not match the `M4%`
policy that governs it, and that is not a bug in one pattern — it is the
consequence of the only matching mechanism being `ILIKE`.

---

## A. Audit — how a model is matched today

| Concern | State | Notes |
| --- | --- | --- |
| `products.model` | **EXISTS** | Free text, exactly as typed or OCR'd. No normalisation anywhere |
| `warranties.model_pattern` | **EXISTS** | A single SQL `LIKE` pattern per policy |
| `warranties.serial_patterns` | **EXISTS** | `text[]` of `LIKE` patterns; nothing populates it |
| `organisation_relationships.model_pattern` | **EXISTS** | Same mechanism, same limits |
| Matching | **`p.model ILIKE w.model_pattern`** | In `match_warranty_policies()` and `probe_resolution()` |
| Canonical model | **MISSING** | |
| Model family | **MISSING** | |
| Aliases | **MISSING** | |
| Normalisation | **MISSING** | `normaliseModel()` in `@mw/domain` strips non-alphanumerics and is used only by duplicate detection, never by matching |
| Brand aliases | **PARTIAL** | `org_name_key()` folds case and legal suffixes; nothing maps "Apple Computer" to Apple |
| OCR cleanup | **MISSING** | `ocr-extract` stores raw text; nothing repairs `O`/`0` in a model code |
| Match explanation | **PARTIAL** | Signals are recorded; the reason a *model* matched is not, because there is only one way it can |
| Ambiguity | **MISSING** | `rankCandidates()` always returns a leader. Conflicts are detected on *values*, never on *identity* |

### Why `ILIKE` cannot be the primary strategy

A single pattern per policy has to be simultaneously tight enough to exclude the
wrong product and loose enough to admit every way the right one is written. Those
requirements point in opposite directions, and the corpus has to choose:

| Pattern | Admits | Also admits (wrongly) | Rejects (wrongly) |
| --- | --- | --- | --- |
| `M4%` | `M4 MacBook Air` | `M4 Mac mini`, `M4 iPad Pro` | `MacBook Air M4`, `MBA M4` |
| `%M4%` | most orderings | `M4%` plus anything containing "m4" | — |
| `QE%S95%` | `QE65S95DATXXH` | — | `S95D`, `Samsung S95D 65` |

The pilot's failure was the third column of the first row. Widening the pattern
to `%M4%` fixes that case and creates a worse one — the phase brief calls this
`model_pattern_too_broad`, and it is a *false resolution*, which is the failure
mode that matters most.

The deeper problem is that `LIKE` compares a user's string to a publisher's
string. What the corpus actually knows is that a set of written forms all denote
one product, and no single regular expression is that set.

## B. Reuse decisions

| Proposed | Decision |
| --- | --- |
| `product_models` (canonical) | **New.** Nothing in the schema can hold "Samsung S95D, television, family S95, 2024 generation". `warranties` is a policy, not a product |
| `model_aliases` | **New.** The alias set is the fact the corpus researches, and it needs its own provenance, verification and publication state — the same lifecycle every other researched fact has |
| Model family | **A column on `product_models`**, not a table. A family is a name plus a manufacturer; a table would add a join and no information |
| `warranties.model_id` | **Extend `warranties`.** A nullable link to a canonical model, *alongside* `model_pattern` rather than replacing it: category-wide policies genuinely have no model, and every existing row keeps working |
| Normalisation | **New `@mw/domain/model.ts`.** Deterministic, shared by the app, the console and the importer. `normaliseModel()` grows from "strip punctuation" into a token model |
| Brand aliases | **Reuse `organisations`** + a new `organisation_aliases` table. Brand, importer and corporate parent are already distinct entities; what is missing is the *names* each is written under |
| Fuzzy matching | **In TypeScript, not in SQL.** `pg_trgm` would put half the matching logic in a second language again, and the parity test exists because that is expensive |
| Ambiguity | **A new outcome, not a new table.** `ModelMatch` gains an `ambiguous` state with its candidates; storing it would make it a queue, and the queue for that is review |

Net: 3 tables added, 1 extended, 1 domain module added, nothing replaced.

## C. What deliberately does not change

`model_pattern` stays and keeps working. A policy that genuinely applies to a
range — every Samsung television sold in Israel — is expressed by a pattern, and
Stage E still evaluates it. What changes is that a pattern is no longer the
*only* way to match, and no longer the first one tried.

The scoring weights are untouched. `MATCH_SIGNALS.model` still carries 22 points;
what changes is how the `model` signal comes to be true, and that a signal now
records *which stage* set it.
