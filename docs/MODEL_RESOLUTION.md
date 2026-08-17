# Model resolution

How a string on a receipt becomes a product the corpus knows, and what happens
when it cannot.

---

## 1. The problem

Before Phase I.5 a policy said which products it covered with one SQL `LIKE`
pattern. That pattern has to be simultaneously tight enough to exclude the wrong
product and loose enough to admit every way the right one is written, and those
requirements point in opposite directions:

| Pattern | Admits | Also admits, wrongly | Rejects, wrongly |
| --- | --- | --- | --- |
| `M4%` | `M4 MacBook Air` | `M4 Mac mini`, `M4 iPad Pro` | **`MacBook Air M4`**, `MBA M4` |
| `%M4%` | most orderings | every M4 Mac ever made | — |
| `QE%S95%` | `QE65S95DATXXH` | — | `S95D`, `Samsung S95D 65"` |

The pilot's failure was the third column of the first row. Widening the pattern
fixes that case and creates a worse one, because a **false resolution** — a
confident answer that is wrong — costs a user a trip to a service centre that was
never going to honour their warranty. An unresolved case only costs them a
search.

The deeper problem is that `LIKE` compares a user's string to a publisher's
string, and what the corpus actually knows is that a *set* of written forms
denote one product. A set is not a regular expression.

## 2. Two rules

**Nothing collapses on a guess.** `S95D` and `S95C` are one character apart and
are different television generations with different terms. Anything the matcher
cannot distinguish structurally comes back as *ambiguous*, with the candidates
and a list of what would settle it.

**Product knowledge lives in the corpus, not in the code.** There is no table in
`@mw/domain` mapping "MBA" to "MacBook Air", because that is a fact about Apple
that somebody has to research and a reviewer has to approve. What lives in code
is *structure*: how separators work, where a screen size hides inside a Samsung
part code, which characters OCR confuses. Structure is the same for every
manufacturer; product knowledge is not.

## 3. Normalisation

`parseModel(raw, { brands })` in `packages/domain/src/model.ts`. Deterministic,
no network, no model. It splits a string into what identifies a product and what
merely describes it.

1. **Unicode.** NFKC folds fullwidth and compatibility forms from Asian-market
   exports; bidi controls are stripped, because they are invisible and would
   otherwise become part of a token.
2. **Case and separators.** Uppercased; spaces, hyphens, en/em dashes, slashes,
   underscores, dots, brackets, the Hebrew geresh and gershayim all become one
   separator.
3. **Brand.** Stripped when it leads or trails — "Samsung QE65S95D" and
   "QE65S95D" are the same model. Kept in the middle, where it may be part of a
   product name ("Samsung Galaxy Book"). Which strings are brands comes from the
   corpus.
4. **Descriptors removed.** `INCH`, `GEN`, `SERIES`, `EDITION` and a handful
   more. The list is deliberately short: every word added is a word two products
   could be distinguished by.
5. **Attributes extracted, not discarded.** Screen size (`13-inch`, `65"`, or the
   two digits inside a TV part code), capacity (`512GB`, `1TB`), and the market
   suffix on a structured code (`ATXXH`, `AFXZA`).
6. **Structured codes decomposed.** `QE65S95DATXXH` → prefix `QE`, 65 inches,
   series `S95D`, market `ATXXH`. The prefix list is layout, not a product
   database; an unrecognised code simply stays whole.
7. **Identity.** The remaining tokens, sorted and joined. Sorted because
   "MacBook Air M4" and "M4 MacBook Air" are one product written by two people.

```
  MacBook Air 13-inch M4   →  tokens [MACBOOK, AIR, M4]   size 13
  M4 MacBook Air           →  tokens [M4, MACBOOK, AIR]   size —
  identity                 →  "AIR M4 MACBOOK" for both
```

### Comparison

`compareModels(a, b)` returns one of four relations:

| Relation | Meaning | Example |
| --- | --- | --- |
| `exact` | same product | `Samsung QE65S95D` / `S95D` |
| `variant` | same product line, an attribute differs | `QE65S95D` / `QE55S95D` |
| `family` | same line, different member | `Dyson V15` / `Dyson V15 Detect` |
| `none` | unrelated | `QE65S95D` / `SV18` |

Two design decisions here were made by tests rather than by taste.

**Containment is `family`, never `exact`.** An earlier version treated "one
identity contained in the other, sharing every part code" as equality, which
made `Dyson V15` and `Dyson V15 Detect` the same product. They are two SKUs. The
cases that genuinely need to agree — `MacBook Air 13-inch M4` — pass anyway,
because their extra words are descriptors and were removed in step 4.

**A size stated on one side only is agreement.** "S95D" is how people write the
television they own. A size stated on *both* sides and differing is a `variant`,
which is reported rather than decided: whether two sizes share a warranty is a
question about the policy, not about the strings.

### `familyKey`

`S95D` → `S95`; `V15` → `V15`; `M4` → `M4`. The trailing generation letter is
dropped and nothing else is — the one suffix convention that holds across
manufacturers.

It returns **null for a name with no part code in it**, on purpose. Deriving
"MacBook" as a family would make every MacBook one family and every Galaxy
another. A verbal family name is corpus knowledge and lives in
`product_models.family`.

## 4. OCR

Receipts are photographed, and OCR confuses `O`/`0`/`D`, `I`/`1`/`L`, `S`/`5`,
`B`/`8`, `Z`/`2`, `G`/`6`.

- Substitutions apply **only inside part codes**. A word gets no variants at all:
  "Air" was not misread as "A1r" often enough to justify the false matches that
  tolerance would produce.
- **At most two substitutions**, and the candidate set is capped. A long enough
  code can otherwise reach almost anything.
- A repair is applied **only when exactly one known model is reachable**. Two
  reachable models means the reading is ambiguous, and the honest output is the
  original string plus that fact.
- **The original is never rewritten.** `products.model` keeps what the camera
  saw. A silent correction that guesses wrong is unfindable afterwards.

## 5. The six stages

`resolveModel(raw, models, { patterns, brands })` in
`packages/domain/src/modelMatch.ts`.

| | Stage | What it matches | Trust |
| --- | --- | --- | --- |
| A | `canonical` | the corpus's own name for the product | **trusted** |
| B | `alias` | a researched, reviewed spelling of it | **trusted** |
| C | `normalised` | the same string once OCR noise is repaired | **trusted** |
| D | `family` | same product line, different member | probable |
| E | `pattern` | a policy's `model_pattern` | trusted *if specific* |
| F | `fuzzy` | tokens overlap, nothing structural agrees | weak |

**Only trusted stages resolve on their own.** Probable and weak candidates go to
a person.

Stage E is the pre-existing mechanism and keeps working, with one addition: a
pattern is trusted only when it constrains at least four literal characters.
`%M4%` has two, so it produces a `probable` candidate and the reason
`model_pattern_too_broad` — which tells a reviewer to narrow it before it
mismatches something.

Aliases count only when a reviewer approved them: `publication_status` of
`verified` or `published`, and `verification` above `ai_extracted`. A model may
propose "MBA M4" during ingestion; a proposal that resolves a stranger's warranty
is a proposal pretending to be a fact.

## 6. Ambiguity

Two candidates of equal standing pointing at different products produce
`state: 'ambiguous'` — never a choice.

The result carries `distinguishers`, derived from what actually differs between
the candidates:

| The candidates differ by | It asks for |
| --- | --- |
| market part number | the model code on the label, the region |
| variant or family | the model code, the purchase date |
| screen size or capacity | the size, the capacity |
| anything | the serial number |

Asking for a serial number when the candidates differ only by screen size wastes
the user's time and ours, which is why the list is computed rather than fixed.

## 7. Explanation, not a score

Every candidate carries `evidence: string[]`, and the resolution carries an
ordered `explanation`. The Model Resolver and the Resolution Tester show those;
neither shows a bare number.

```
Read “QE65S95DATXXH” as S95D, 65", region ATXXH
Stage A (canonical) resolved it: Matches the canonical model “Samsung S95D”
```

## 8. When it fails

Eight failure reasons were added in this phase, each naming a *fix* rather than a
symptom:

| Reason | What to do |
| --- | --- |
| `model_alias_missing` | near enough to see, not near enough to trust — add an alias |
| `model_ambiguous` | two products match; the app asks the user |
| `model_pattern_too_broad` | narrow the pattern, or replace it with a `model_id` |
| `model_pattern_no_match` | the model is unknown to the corpus entirely |
| `importer_conflict` | the receipt and the policy name different importers — probably a grey import |
| `policy_date_conflict` | the purchase predates the terms in force |
| `service_capability_missing` | the repairer is known, what they can do is not |
| `location_missing` | no branch recorded |

## 9. Metrics

| Metric | Measures |
| --- | --- |
| Full Resolution Rate | all five stages cleared |
| Auto Resolution Rate | …and nothing was asked of the user |
| Ambiguity Rate | several credible answers, so the app asked |
| **False Resolution Rate** | a confident answer that a reviewer later found wrong |

False resolution is measured over **reviewed runs only**. Dividing by every run
would drive the number towards zero simply by running the suite more often, which
is a metric that rewards not looking. Only a person can set it; a run cannot know
it was wrong.

## 10. Where things live

| | |
| --- | --- |
| `packages/domain/src/model.ts` | parsing, comparison, OCR, pattern specificity |
| `packages/domain/src/modelMatch.ts` | the six stages, ambiguity, distinguishers |
| `packages/domain/src/identity.ts` | organisation names, receipt evidence, serial rules |
| `product_models` | one row per product the corpus can name |
| `model_aliases` | every approved spelling, with its own provenance and review state |
| `organisation_aliases` | the same for company names, including Hebrew |
| `warranties.model_id` | the precise link, preferred over `model_pattern` |
| `probe_models()` | the corpus for one brand, as the matcher wants it |
| `/models` | the console screen, with the Model Resolver on it |
