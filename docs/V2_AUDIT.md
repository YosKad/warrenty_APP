# V2 audit and gap analysis

Audit of the existing repository against the V2 specification, performed before
any V2 code was written. Baseline at time of audit: `tsc --noEmit` clean,
`eslint --max-warnings 0` clean, 92 tests passing.

## A. What exists

| Area | State | Notes |
| --- | --- | --- |
| Expo / React Native / TypeScript strict | Solid | SDK 57, RN 0.86, Expo Router with 29 routes |
| Service-layer isolation | Solid | 12 services; no component touches Supabase directly |
| Domain purity | Solid | 6 modules, no React or I/O, 92 tests without mocks |
| Semantic design tokens | Solid architecture, weak palette | Three layers (palette → semantic → screens) is exactly right. The *values* are the problem, not the structure |
| Workspace ownership | Solid | Every product belongs to a workspace; family sharing slots in without migration |
| RLS | Solid | 46 policies, default deny, column-level grants |
| Organisation roles | Solid | Manufacturer / importer / retailer / warranty provider / service provider already distinct |
| Versioned warranty policies | Solid | `valid_from` / `valid_to`, resolution by specificity then verification state |
| Provenance + confidence | Solid | `warranty_sources`, `verification_state`, `confidence_level`, `ProvenanceNote` component |
| AI coverage contract | Solid | Schema-validated, ungrounded verdicts demoted client *and* server |
| Prompt-injection isolation | Solid | Structural delimiters + output contract + sanitisation |
| Entitlements | Solid | Feature keys not plan names; Postgres trigger enforces the limit |
| Server-side reminders | Solid | pg_cron → Edge Function, idempotent |
| i18n + RTL | Solid | en/he, bidi isolates on identifiers |

**Nothing in this list is being replaced.** V2 evolves all of it.

## B. Gap analysis — V2 Core

| # | V2 Core requirement | Status | What's actually missing |
| --- | --- | --- | --- |
| 3–7 | Visual redesign, warm light/dark | **PARTIAL** | Token *architecture* exists; palette is generic navy. Needs new values + new semantic roles, not a rewrite |
| 8–9 | Product imagery, redesigned cards | **MISSING** | One generic mark for every product. No per-category illustration, no image pipeline in the card |
| 10 | Home redesign | **PARTIAL** | Screen exists but is three statistic tiles. Needs to become actionable |
| 11 | Protection Score | **MISSING** | No scoring model at all |
| 12 | Protection completeness | **MISSING** | No per-product completeness or missing-field list |
| 13–14 | Product Detail hero + quick actions | **PARTIAL** | Detail screen exists with timeline and provenance; no hero imagery, no quick-action row |
| 15 | Warranty Intelligence panel | **PARTIAL** | `getWarrantyDetail` returns provider/source/verification already. No UI surface for it |
| 16 | What's covered / not covered | **PARTIAL** | `coverage_summary`, `exclusions_summary`, and per-clause `clause_type` all exist in schema. No structured UI |
| 17 | Clause traceability | **EXISTS** | `getWarrantyClauses(warrantyId, clauseIds)` already supports it; coverage result already renders verbatim excerpts |
| 18 | Warranty intelligence pipeline | **PARTIAL** | `resolve_warranty_policy` does brand→model→country→date. Importer/service resolution exists in `serviceProviderService.getProviderChain`. Not chained into the add flow |
| 19 | Israel importer support | **EXISTS** | `org_role` enum already separates importer from manufacturer and warranty provider; seed data demonstrates the chain |
| 20 | Receipt intelligence | **PARTIAL** | Deterministic-first extraction exists; field set is narrower than V2 asks (no importer, provider, phone) |
| 22 | Ask about a problem | **EXISTS** | Coverage screen has description + category input |
| 23–24 | Coverage analysis + result UX | **EXISTS** | Full RAG pipeline, verdict vocabulary, cited clauses, disclaimer |
| 26–27 | Service Concierge | **PARTIAL** | `getProviderChain` returns all four roles + locations. No dedicated screen, no contact channels modelled |
| 38 | Activity redesign | **MISSING** | `notifications` is delivery only. No permanent activity history |
| 41–42 | Auth + cloud sync | **EXISTS** | Apple, Google, email, reset, delete; all data workspace-scoped and server-side |
| 44 | Profile redesign | **PARTIAL** | Works, but reads prototype-ish; missing grouping the spec asks for |
| 55 | Add Product redesign | **PARTIAL** | Four equal cards; needs a primary/secondary hierarchy |
| 60 | Localisation of new work | **N/A yet** | Must not regress |

### V2.1 and Future — not started, by design

Warranty Case, service timeline, pre-expiry checkups, nearest service centre,
Ask MY, recalls, protection layers, email import, family sharing. Schema
foundations for several of these land in this migration; UI does not.

### BLOCKED (unchanged from V1, carried forward)

| Blocker | Why |
| --- | --- |
| Apple JWS certificate-chain verification | Needs App Store Server API credentials |
| `expo-iap` offerings bridge | Needs App Store Connect / Play Console products |
| Store notification webhooks | Needs store configuration |
| OCR provider credentials | No provider account |
| Embedding provider credentials | No provider account |
| Real warranty policy data | Editorial work — the pipeline is built, the corpus is empty |

Item 74 of the spec is explicit that these must not disappear. They are
restated in `docs/STORE_RELEASE.md` and unchanged.

## C. Honest assessment of the visual criticism

The spec's critique is fair. Reviewing the V1 UI against item 79's checklist:

- **Repeated rounded cards** — yes. `Card` is used for everything, so Home is a
  stack of near-identical 14px-radius rectangles.
- **Generic navy** — yes. `#0B1220` as brand surface, `#F7F8FA` as canvas. It is
  the default "serious app" palette.
- **Placeholder icons** — yes, and this is the worst of it. Every product shows
  the same 24px mark in a grey square. Nothing about a list of products tells you
  what those products *are*.
- **Giant dashboard statistics** — yes. Three numeric tiles is the first thing on
  Home, and a count of "6 active" is not an action.
- **Weak hierarchy** — partly. The type scale is disciplined, but every section
  is weighted the same, so nothing leads.

What is *not* wrong and should be preserved: the spacing discipline, the type
scale, status-never-colour-alone, and the provenance line. Those are the parts
that already read as considered.

## D. Reuse decisions for the migration

Per spec item 68, existing tables were reviewed before proposing new ones.

| V2 concept | Decision |
| --- | --- |
| `protection_completeness` | **Compute, don't store.** It is a pure function of columns already on `products` and its documents. Storing it creates a cache to invalidate on every edit. Exposed via a SQL function + the TypeScript domain module so both agree |
| `service_centers` | **Reuse `service_locations`.** Already has org, country, region, city, address, phone, coordinates, opening hours |
| `service_capabilities` | **New** — `service_capabilities` linked to organisation and/or location. Home visit, pickup, mail-in, walk-in, phone support, each with an explicit `unknown` state |
| `provider_contact_methods` | **New** — providers legitimately have several phones, WhatsApp numbers, emails, forms. Spec item 69 is right that this must not live in one giant provider row |
| `warranty_cases` | **Extend `claims`.** It already models product, owner, status, issue, snapshot, provider, reference number, resolution. Adds case number, appointment, cost, channel |
| `case_events` | **Extend `claim_messages`** into a typed event stream rather than a second table |
| `case_attachments` | **Reuse `product_documents`** with a `claim_id` link |
| `activity_events` | **New** — genuinely distinct from `notifications`. Spec item 39 is correct: notification is delivery, activity is permanent history |
| `product_protection_layers` | **New** — a product can carry manufacturer warranty plus extended plus card protection simultaneously. Cannot be modelled by the single warranty window on `products` |
| `product_checkups` / `checkup_templates` / `checkup_answers` | **New**, but schema only in this phase |
| `recall_notices` / `recall_matches` | **New**, schema only |
| `assistant_threads` / `assistant_messages` | **Deferred.** Ask MY is V2.1; adding empty tables now is speculative |

Net: 3 tables extended, 8 added, 4 avoided by reuse, 2 deferred.

## E. Risk register

| Risk | Mitigation |
| --- | --- |
| Token change breaks contrast in dark mode | New palette designed against WCAG AA and checked before propagation |
| Redesigning 29 routes at once | Spec item 78 — vertical slice first, validated visually, then propagate |
| Protection Score feels arbitrary | Deterministic weighted model, formula documented in `docs/V2_PLAN.md`, unit-tested |
| New UI ships English-only | Every new string goes through `t()`; both locale files updated in the same commit |
| Regression in the 92 existing tests | Run on every phase; domain changes are additive |
