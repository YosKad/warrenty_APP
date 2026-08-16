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
