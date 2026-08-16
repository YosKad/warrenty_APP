# Phase I — Data Operations Console

Audit written before the schema was touched, per the phase brief.

The product's constraint is no longer code. Phases G and H built a resolver that
can answer "what warranty applies, who honours it, who repairs it, how do I
reach them" — and then correctly refuses to answer, because the tables behind it
are empty. Phase I builds the machine that fills them.

---

## A. Audit

### Data models

| Concern | State | Notes |
| --- | --- | --- |
| `organisations` with role array | **EXISTS** | Five roles, `serviced_brand_ids`, `parent_id`, `is_verified` |
| Organisation **relationships** | **MISSING** | `parent_id` models ownership, not "imports Samsung televisions into Israel since 2024". Scoped, dated relationships need their own table |
| `warranties` | **EXISTS** | Brand, model pattern, category, country, importer, retailer, serial patterns, validity window, policy version |
| `warranty_terms` | **EXISTS** | Clause type, title, summary, verbatim text, section, page, confidence, verification, extraction provenance |
| `warranty_sources` | **PARTIAL** | URL, title, version, content hash, retrieved/verified dates, document link. **No stored snapshot text** — item 14 needs one |
| `product_warranty_matches` | **EXISTS** | Signals, score, state, conflicts, resolver version |
| `product_warranty_overrides` | **EXISTS** | Per-field user corrections with provenance |
| `provider_contact_methods` | **EXISTS** | Kind, purpose, hours, languages, priority, source, verification |
| `service_locations` | **EXISTS** | Address, coordinates, hours, brands, categories, appointment flag, provenance, `closed_at` |
| `service_capabilities` | **EXISTS** | Twelve kinds, three-valued availability, provenance |
| `service_data_reports` | **EXISTS** | Queue with `status`, reviewer fields. **No reviewer** |
| `audit_logs` | **PARTIAL** | Actor, action, entity, metadata. **No before/after** — item 39 needs it |
| Recall schema | **EXISTS** | Schema only, out of scope here |

### Verification and lifecycle

| Concern | State | Notes |
| --- | --- | --- |
| `verification_state` enum | **NEEDS EXTENSION** | `unverified / ai_extracted / community_submitted / verified / official` describes *how good* a fact is, not *where it is in a workflow*. Item 12 wants both, without breaking the resolver that reads the first |
| Publishing | **MISSING** | Nothing distinguishes a row the resolver may use from a row awaiting review |
| Demo vs production data | **MISSING** | The demo fixtures are marked only by naming convention. Item 41 wants a structural guarantee |
| Freshness intervals | **PARTIAL** | `freshness()` in the app uses one interval for everything. Item 25 wants per-class intervals |

### Security

| Concern | State | Notes |
| --- | --- | --- |
| Consumer RLS | **EXISTS** | Default deny, owner-scoped, 46+ policies |
| Reference data | **PARTIAL** | Readable by any authenticated user, writable by none — which is right for consumers and leaves admins with no route in at all |
| Admin role | **MISSING** | No concept of one |
| Admin audit | **PARTIAL** | `audit_logs` exists; nothing writes admin mutations to it |

### Ingestion

| Concern | State | Notes |
| --- | --- | --- |
| `warranty-extract` | **EXISTS** | Document → chunks → classification, stores source text first, marks everything `ai_extracted` |
| `warranty-resolve` | **EXISTS** | Deterministic match scoring, writes `product_warranty_matches` |
| Batch ingestion | **MISSING** | One document at a time, invoked by the app |
| CSV/XLSX import | **MISSING** | Item 20, and the phase is explicitly not complete without it |
| Duplicate detection | **MISSING** | |
| Re-verification | **MISSING** | `content_hash` exists and nothing compares it |

### Applications

| Concern | State |
| --- | --- |
| `apps/mobile` (Expo) | **EXISTS** |
| `apps/landing`, `apps/prototype` | **EXISTS** — static |
| Admin console | **MISSING** — the phase |
| Shared package | **MISSING** — mobile owns `src/domain`; the resolver logic the console needs to reuse lives inside the Expo app |

## B. Reuse decisions

| Proposed | Decision |
| --- | --- |
| `admin_users` table | **New `admin_members`** — a small table plus a `SECURITY DEFINER` predicate. Roles on `user_profiles` would put an escalation target on a row users can already update |
| Verification rework | **Additive `publication_status`.** `verification_state` keeps its meaning and every existing query keeps working; the new column answers a different question — is this live |
| `organisation_relationships` | **New.** `parent_id` cannot express scope or dates, and item 8 is explicit that a relationship is not globally permanent |
| Source snapshots | **New `warranty_source_snapshots`.** Kept out of `warranty_sources` so a re-fetch appends rather than overwrites, which is what makes the audit trail work |
| Import jobs | **New `import_jobs` + `import_rows`.** Row-level status is what produces the error report item 20 requires |
| Extraction queue | **Reuse `ocr_jobs`?** No — it is receipt-shaped and per-user. **New `extraction_jobs`**, global and admin-owned |
| Resolution tester | **New `resolution_runs`.** Storing runs is what turns the KPI from a number into a trend |
| Freshness rules | **New `freshness_policies`** — one row per data class, so the intervals are data rather than constants |
| Audit before/after | **Extend `audit_logs`** with `before`/`after` JSONB |
| Shared domain package | **New `packages/domain`.** The console must score matches identically to the app; two copies of the weights is how they drift |

Net: 8 tables added, 3 extended, 2 avoided by reuse, 1 shared package extracted.

## C. What deliberately does not change

The consumer RLS model is untouched. Admin access is additive: new policies keyed
on an `is_admin()` predicate, alongside the existing owner-scoped ones rather
than replacing them. A normal user's reach into global data stays exactly what it
is today — read reference data, write nothing.

`verification_state` is not redefined. The resolver's source hierarchy depends on
its ordering, and it is pinned by tests in both languages.

---

## D. What shipped

| Requirement | Where |
| --- | --- |
| 1–2 Audit before touching the schema | This document, sections A–C |
| 3 Console application | `apps/admin` — Next.js, TypeScript, desktop-first |
| 4 Admin authorization, default deny | `admin_members` + `is_admin()`; no service-role key in the console, so RLS decides every request |
| 5 Dashboard led by work, not totals | `app/(console)/page.tsx` |
| 6–8 Organisations and scoped, dated relationships | `organisation_relationships`, `/relationships` |
| 9–11 Warranty policies, clause review against source | `/warranties/[id]`, `ClauseReview` |
| 12 Verification lifecycle | `publication_status`, orthogonal to `verification` |
| 13–14 Sources and snapshots | `warranty_source_snapshots`, `/sources` |
| 15–16 Conflicts, product match | `/queues/conflicts` — resolving never deletes evidence |
| 17–19 Providers, contacts, locations | `/organisations/[id]`, `/providers/[orgId]/[kind]/[recordId]` |
| 20 Bulk import (CSV/XLSX) | `/import`, `lib/import/*` — the phase's stated gate |
| 21 Duplicate detection | `scoreOrganisationDuplicate`, `scoreLocationDuplicate` — explained, never merged |
| 22–24 Document ingestion and extraction queue | `extraction_jobs`, `/queues/extraction` |
| 25–26 Per-class freshness, stale queue | `freshness_policies`, `/queues/stale` |
| 27 Re-verification without auto-overwrite | `markVerified` moves `verified_at` and nothing else |
| 28 Ingestion adapters, no crawler | Extraction reads what it was pointed at; stated on the queue and sources pages |
| 29 AI may propose, never publish | Default `candidate`, reviewer-only promotion trigger, explicit write in `warranty-extract` |
| 30–31 Reviewer productivity | One review queue across every table; queue counts in the sidebar |
| 32–35 Israel pilot, measured | `supabase/pilot/israel_pilot.sql`, `docs/ISRAEL_CORPUS_PILOT.md` |
| 36 Full Resolution Rate | `evaluateResolution`, `resolution_rates()`, `/resolution` |
| 37 Test set, synthetic marked | `scripts/pilot-cases.json`; `detail.synthetic` on every run, labelled in the UI |
| 38 Resolution tester | `probe_resolution()` + `ResolutionTester` |
| 39 Audit with before/after | `log_admin_action()`, `/audit` |
| 40 Failure classification | `resolution_failure` enum, `rankFailureReasons` |
| 41 Demo fixtures cannot surface as production | `data_environment`, `visible_environments()`, pinned by `publication_workflow_test.sql` |
| 42 Tests | 66 domain, 35 console, 233 mobile, 4 SQL suites |
| 43 Coverage dashboard | `/coverage`, `brand_corpus_coverage()` |
| 47–48 Documentation | `docs/DATA_OPERATIONS.md`, `docs/ISRAEL_CORPUS_PILOT.md` |

## E. Known limitations

- **The pilot's research half was not performed.** This environment has no
  general web access, so no researched facts and no research-time figure exist.
  `docs/ISRAEL_CORPUS_PILOT.md` says which numbers are measured and which are
  absent, rather than filling the gap with an estimate.
- **The resolution suite is synthetic.** It measures whether the corpus can
  answer questions somebody wrote down. Real receipts are a different
  measurement and the console labels the difference on every row.
- **Model normalisation is weaker than the corpus needs.** "MacBook Air M4"
  fails against an `M4%` pattern — a real gap the pilot exposed and did not fix.
- **No snapshot diffing yet.** `warranty_source_snapshots` stores text and a
  `changed_from_previous` flag; nothing computes the flag, because nothing
  fetches sources in this environment.
- **Duplicate detection is quadratic.** Half a second against 200 existing
  records, roughly a minute at 5,000. Fine now, worth watching.
- **Organisation roles and relationships can disagree.** Roles are typed on the
  organisation; who it acts for is a relationship. Nothing reconciles the two.
