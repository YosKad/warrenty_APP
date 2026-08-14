# Phase G — Warranty Intelligence + What's Covered

Implementation note, written before the schema was touched, per the phase brief.

The question this phase answers is not "can we store warranty text" — V1 already
could — but "can the app tell a user what their specific warranty says, and prove
where it got it from". Almost every piece of storage needed for that already
exists. What is missing is the *reasoning* on top of it: which policy applies,
how sure we are, what happens when two sources disagree, and a stable object the
UI can render without touching a database row.

---

## A. What exists today

| Concern | Where |
| --- | --- |
| Policy records scoped by brand / model pattern / category / country / validity window | `warranties` |
| Provenance for a policy — URL, document title, version, content hash, retrieved and verified dates, editorial state | `warranty_sources` |
| Individual clauses, chunked, typed and embedded | `warranty_terms` |
| Policy resolution ordered by specificity, then verification, then confidence | `resolve_warranty_policy()` |
| The policy that applied at purchase, pinned per product | `products.warranty_id` |
| Provider roles kept distinct rather than collapsed | `organisations.roles` (`org_role` enum) |
| Vector retrieval scoped to one policy before ranking | `match_warranty_terms()` |
| Coverage analysis with clause citation, schema validation and ungrounded-verdict demotion | `supabase/functions/ai-coverage`, `src/domain/coverage.ts` |
| Full audit trail of every analysis | `ai_analyses` |
| Prompt-injection defences for document and user text | `_shared/prompt-safety.ts` |

The architecture was already right about the two things that are hardest to
retrofit: policies are versioned by validity window, and provider roles are
separate. Neither needed changing.

## B. Gap analysis

| # | Phase G requirement | State | Action |
| --- | --- | --- | --- |
| 2 | "Your warranty" section on Product Detail | **MISSING** | New feature components |
| 3 | Manufacturer / importer / retailer / warranty provider / service provider chain | **PARTIAL** | `org_role` has `importer`, but `products` has no `importer_id`. Add one |
| 4 | What's covered / not covered / special conditions | **PARTIAL** | Clauses are typed, but only into 6 buckets, and there is no derived grouping |
| 5 | Clause structure — title, summary, source section, page, confidence, verified status | **PARTIAL** | `warranty_terms` has `section`, `ordinal`, `clause_text`, `clause_type`, `coverage_categories`. The rest is missing. Extend additively; never touch `clause_text` |
| 5 | Clause types `service_fee`, `claim_requirement`, `geographic_restriction` | **MISSING** | Widen the check constraint |
| 6 | Source traceability down to document and page | **PARTIAL** | Source exists per policy, not per clause. Add `source_page` / `source_section` to clauses and a document link to sources |
| 7 | Deterministic source hierarchy | **PARTIAL** | Ordering exists inside `resolve_warranty_policy`, but nothing names the hierarchy or exposes it |
| 7 | Conflict state when sources disagree | **MISSING** | Detect in the domain layer; surface, never silently pick |
| 8 | Matching on importer, retailer, serial range | **MISSING** | Add to the policy record and to a new matching function |
| 9 | Deterministic match-confidence model | **MISSING** | `confidenceScore()` in `warranty-lookup` is a four-line heuristic, not a signal model |
| 10 | Intentional "not identified yet" state | **MISSING** | New UI state with real actions |
| 11 | Document → structured intelligence pipeline | **PARTIAL** | `ocr-extract` handles receipts. Warranty documents have no clause pipeline |
| 12 | AI-derived summaries carry source, confidence, extraction version | **PARTIAL** | True for analyses, not for extracted clauses |
| 13 | "Something wrong?" entry point on Product Detail | **PARTIAL** | The coverage route exists; the entry point is a plain button |
| 14 | Coverage pipeline grounded in the applicable policy | **EXISTS** | Already correct — verified during the audit |
| 15 | `missing_information`, follow-up questions in the result contract | **MISSING** | Extend `coverage.ts` and the Edge Function |
| 16 | Polished result UX | **PARTIAL** | Functional but plain; no clause viewer, no next-step CTA |
| 17 | Structured clarification instead of guessing | **MISSING** | Add follow-up questions that retain issue context |
| 18 | Problem photos stored and honestly labelled | **PARTIAL** | `attachmentIds` is accepted and then ignored |
| 19–20 | `WarrantyIntelligenceService` + typed domain object | **MISSING** | The centrepiece of this phase |
| 21 | Persisted intelligence, not recomputed per screen open | **MISSING** | New `product_warranty_matches` |
| 22 | Freshness — policy version, last verified, last retrieved | **PARTIAL** | On sources; not per match |
| 23 | User corrections stored with provenance | **PARTIAL** | Only `warranty_verified_by_user`, a boolean |
| 26 | Demo fixtures | **MISSING** | Seed file, clearly marked |
| 27 | Tests | **PARTIAL** | Coverage contract is tested; matching, priority and conflicts are not |
| 28 | RLS and document isolation | **EXISTS** | Preserved unchanged; new tables follow the same three shapes |
| 29 | Privacy-safe analytics | **PARTIAL** | Some events exist; the new ones do not |

## C. Reuse decisions

Per the same rule as Phase E: check what exists before adding anything.

| Proposed | Decision |
| --- | --- |
| `warranty_policies` | **Reuse `warranties`.** It already is one |
| `warranty_clauses` | **Reuse `warranty_terms`.** Extended additively — `clause_text` keeps its meaning as the verbatim source text and is never overwritten |
| `clause_sources` | **Reuse `warranty_sources`**, plus a `document_id` link so a user-uploaded PDF becomes a first-class source |
| `warranty_match` | **New `product_warranty_matches`** — one row per product, holding the resolved policy, the signals behind it, the confidence state and the extraction version. This is both the cache required by item 21 and the freshness record required by item 22 |
| `warranty_overrides` | **New `product_warranty_overrides`** — field-level corrections with their own provenance, so an official value is never silently overwritten (item 23) |
| `coverage_items` / `exclusion_items` | **Derived, not stored.** They are a grouping of `warranty_terms` by `clause_type`. Storing them would create a second copy of the document to keep in sync |
| `warranty_intelligence` cache table | **Folded into `product_warranty_matches`.** A second cache would need the same invalidation |

Net: 2 tables added, 3 extended, 4 avoided by reuse.

## D. What deliberately does not change

`resolve_warranty_policy()` keeps its signature and behaviour — the add-product
flow and `warranty-lookup` both depend on it. The richer matching lands as a new
function beside it rather than a redefinition, so nothing that works today can
regress.

The coverage verdict vocabulary does not gain a "covered". The demotion rule —
`likely_covered` with no cited clause becomes `possibly_covered` — stays enforced
in both the Edge Function and the client.


---

## E. What shipped

| Requirement | Where |
| --- | --- |
| 2 Your warranty | `src/features/warranty/WarrantyIntelligenceSection.tsx` |
| 3 Entity separation | `products.importer_id`, `buildProviderChain()` — five roles, never collapsed |
| 4 What's covered | `app/warranty/[productId].tsx`, `groupClauses()` |
| 5 Clause structure | `warranty_terms` + title, summary, source section, page, confidence, verification, extraction provenance; three new clause types |
| 6 Source traceability | `ClauseSourceSheet` — verbatim text, section, page, version, retrieved and verified dates |
| 7 Source hierarchy + conflicts | `SOURCE_PRIORITY`, `outranksSource()`, `detectConflicts()` |
| 8 Matching | `match_warranty_policies()` — brand, model, category, country, importer, retailer, serial, validity |
| 9 Match confidence | `MATCH_SIGNALS` (100 total) → `verified` / `strong` / `needs_confirmation` / `unknown` |
| 10 Unknown state | `NotIdentified` with four real actions |
| 11 Document ingestion | `supabase/functions/warranty-extract` |
| 12 AI provenance | `extraction_version`, `extracted_by`, `extracted_at`, `verification = 'ai_extracted'` |
| 13 Something wrong? | `src/features/warranty/SomethingWrongCard.tsx` |
| 15 Result contract | `missingInformation`, `followUpQuestions`, `attachmentCount`, `attachmentsAnalysed` |
| 16–17 Result UX + clarification | `app/coverage/[productId].tsx` |
| 19–20 Service | `src/services/warrantyIntelligenceService.ts` |
| 21–22 Cache + freshness | `product_warranty_matches`, `isMatchStale()` |
| 23 Overrides | `product_warranty_overrides`, `applyOverride()` |
| 26 Fixtures | `supabase/seed_demo_warranty.sql` |
| 27 Tests | `src/domain/__tests__/warrantyIntelligence.test.ts`, `supabase/tests/warranty_matching_test.sql` |
| 29 Analytics | six events, carrying states and types — never clause text |

## F. Known limitations

- **Embeddings and the model are unconfigured.** Retrieval falls back to the
  policy's coverage and exclusion clauses, which is grounded but less precise.
  `EMBEDDING_PROVIDER_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL` and
  `ANTHROPIC_API_KEY` are still required.
- **No warranty corpus.** The matcher is only as good as what it matches
  against, and outside the demo fixtures there are no policies.
- **Photos are stored, not analysed.** `attachmentsAnalysed` is hard-coded
  false and the UI says so.
- **Conflict resolution is read-only.** The conflict is shown and the user can
  correct the fields it concerns, but there is no one-tap "this one is right"
  that pins the losing candidate.
- **`warranty-extract` needs `extracted_text`.** PDFs still have to go through
  OCR first; the two pipelines are not yet chained.
