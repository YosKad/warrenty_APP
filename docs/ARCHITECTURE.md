# Architecture

## 1. What the product is

MY Warranty is a personal warranty wallet. A user records what they own; the app
knows when cover ends, what the warranty says, and who to contact when something
breaks.

The product's credibility rests on one property: **it never claims to know
something it does not know.** A wrong warranty date, or a confident "you're
covered" that a manufacturer later refuses, is worse than no answer at all —
the user acts on it and loses money. Every architectural decision below traces
back to that.

Three consequences run through the codebase:

- An unknown warranty stays `unknown`. `resolveWarrantyPeriod` returns `null`
  rather than defaulting to twelve months.
- Automatically-derived data is labelled with its source and confidence
  wherever it appears (`ProvenanceNote`), and low-confidence values ask for
  confirmation before the app treats them as settled.
- A coverage verdict must cite a real clause from a real document. The strongest
  verdict available is "likely covered", and one with no supporting clause is
  demoted — in the client *and* in the Edge Function.

## 2. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | React Native 0.86 + Expo SDK 57, TypeScript strict | One codebase, native modules where needed, and a managed build pipeline that does not stop us dropping to native. |
| Routing | Expo Router (typed routes) | File-based routing with deep links and typed params; the route tree *is* the navigation map. |
| Server state | TanStack Query | Caching, retry policy and invalidation in one place. The cache doubles as the offline read layer. |
| Client state | Zustand | Two small stores (session, product draft). Redux would be ceremony for this. |
| Forms | React Hook Form + Zod | One schema validates the same product whether it was typed, scanned or looked up. |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions, pgvector) | Postgres with RLS gives per-row authorisation in the database rather than in application code. pgvector keeps clause retrieval next to the data. |
| Model access | Anthropic API from Edge Functions | No key ever ships in the binary. |

### Why Expo dev builds, not Expo Go

The app needs Sign in with Apple, StoreKit / Play Billing, camera, secure
storage and local authentication. Expo Go cannot host those. `expo prebuild`
plus EAS Build gives the native projects while keeping config declarative in
`app.config.ts`.

### Repository layout

```
apps/mobile/           the Expo app (self-contained: own package.json, lockfile)
  app/                 Expo Router route tree
  src/theme/           design tokens + ThemeProvider
  src/ui/              design-system components
  src/domain/          pure business logic — no I/O, no React
  src/services/        the only modules that talk to Supabase
  src/hooks/           TanStack Query bindings screens consume
  src/features/        composed, feature-specific components
  src/i18n/            translations (en, he)
supabase/
  migrations/          schema, RLS, RPCs, cron
  functions/           Edge Functions (Deno)
docs/                  this directory
```

**On the monorepo question.** The brief suggested npm workspaces with
`packages/ui`, `packages/types`, `packages/api`. We deliberately did not do
that yet, and the tradeoff is worth stating.

Workspaces pay off when two or more consumers share code. Today there is one
consumer. What a workspace setup would buy us — shared types between the app and
the Edge Functions — it cannot actually deliver: the functions run on Deno with
URL imports, so they would not consume an npm workspace package anyway. What it
would cost is real: Metro resolution configuration, hoisting problems with
native modules, and a slower install on every CI run.

So `apps/mobile` is self-contained, and the migration path stays open. When the
admin console arrives it becomes `apps/admin`; at that point the shared pieces
(design tokens, domain logic, types) get extracted into `packages/*` and a
workspace root is added. The code is already organised for that split —
`src/domain` has no React or I/O dependencies and would move unchanged.

## 3. Layering

```
        screens (app/)
             │  consume hooks only
        hooks (src/hooks/)
             │  call services only
      services (src/services/)
             │  the only Supabase callers
        Supabase ── RLS ── Postgres
             │
      Edge Functions (privileged work)
```

Rules the codebase holds to:

- No component calls `supabase.from(...)` directly.
- No service contains business logic; that lives in `src/domain`, pure and
  tested.
- Errors leave a service as an `AppError` with a stable code. The UI translates
  the code. Raw Postgres messages never reach a user.

`src/domain` being pure is what allows the warranty engine to be tested
exhaustively (92 tests, no mocks) and mirrored exactly in SQL for the server-side
scheduler.

## 4. Data model

Full detail in [DATABASE.md](./DATABASE.md). The shape worth understanding here:

**Products belong to workspaces, not users.** Every user gets a personal
workspace at signup and the concept is invisible in the UI. It exists now
because retrofitting shared ownership later would mean migrating every product,
document, claim and RLS policy in the system. Family and business plans slot in
by adding members to a workspace.

**Organisations have roles, not types.** A manufacturer, a country importer, a
retailer and a repair shop are four different companies playing four different
roles, and they are frequently not the same entity. Modelling them as one table
with a `roles` array keeps the relationships explicit — which is what lets the
app tell a user to call the local importer rather than uselessly suggesting they
"contact Samsung".

**Warranty knowledge is separate from user data.** `warranties` holds policies
scoped by brand + model pattern + category + country + validity window;
`warranty_terms` holds individual clauses with embeddings;
`warranty_sources` holds provenance. A product links to the policy that applied
*at its purchase date*, so a manufacturer changing their terms in 2027 does not
silently rewrite what a 2024 purchase was covered by.

## 5. Warranty status engine

`src/domain/warranty.ts`, mirrored by `product_warranty_status()` in SQL.

Warranty dates are calendar facts, not instants. "Two years from 20 May 2026" is
20 May 2028 in every timezone, and must not shift when the device crosses a
border or DST rolls over. So they are `date` in Postgres and `YYYY-MM-DD`
strings in TypeScript, with all arithmetic in UTC.

Resolution order, most specific first:

1. an explicit end date (from a document or the user)
2. start + duration + any purchased extension
3. `unknown`

Month arithmetic clamps: 31 Jan + 1 month is 28 Feb (29 in a leap year), which
is what "one month later" means to a consumer and to warranty terms.

The day a warranty ends counts as covered — `daysRemaining === 0` is
`ending_soon`, never `expired`.

## 6. Entitlements

`src/domain/entitlements.ts` and `enforce_product_limit()` in Postgres.

Feature checks ask "does this user have `ai_coverage`?", never "are they on
Plus?". Pricing and limits can then change server-side without an app release.

The client checks quota to open the paywall at the right moment. The database
trigger is what actually enforces it — a patched client can call the API but
cannot exceed its quota.

Two rules that are product decisions, not technical ones:

- Grace period and billing retry still entitle. A failed card is not a
  cancellation, and locking someone out of their own receipts over a payment
  hiccup is hostile and churns users.
- Downgrading restricts *creation only*. A user who drops to Free with 15
  products keeps read, edit and export access to all 15. The trigger fires on
  INSERT, never on SELECT or UPDATE.

## 7. AI

Full detail in [AI.md](./AI.md). The shape:

```
user describes fault
  → resolve the warranty policy that applied at purchase   (SQL)
  → embed the description                                  (small model)
  → retrieve ~6 relevant clauses                           (pgvector, in Postgres)
  → send only those clauses to the reasoning model
  → validate against a strict schema
  → demote any verdict not supported by a cited clause
  → persist with model version, prompt version, clause ids
```

No warranty document is ever sent wholesale to a model. Retrieval happens
inside Postgres, so only the handful of clauses that matter leave the database.

Uploaded documents and user text are treated as untrusted input: wrapped in
delimiters the system prompt names as quoted material, sanitised for delimiter
forgery, and — the defence that actually holds — constrained by an output schema
where an injected "everything is covered" cannot survive without a real clause id
behind it.

## 8. Security

Full detail in [SECURITY.md](./SECURITY.md). The load-bearing points:

- RLS on every table, default deny. Frontend filtering is convenience, never
  control.
- UUID primary keys throughout; no sequential ids are exposed.
- Storage objects are keyed `<ownerId>/<productId>/<uuid>`, and the Storage
  policies authorise on that first path segment. Guessing another user's path
  fails at the storage layer, not just in the metadata table.
- Auth tokens live in the Keychain / Keystore, never AsyncStorage.
- Backend-owned tables (`subscriptions`, `ai_analyses`, `notifications`) have
  SELECT policies for their owner and no INSERT policy at all. Only service-role
  writes them.
- Column-level grants stop a hand-crafted PostgREST call rewriting `owner_id` or
  an AI verdict.

## 9. Offline

TanStack Query's cache with a 24-hour `gcTime` means previously-loaded products
remain readable without a connection. Document viewing needs the network
(signed URLs are minted on demand and expire).

Product creation while offline is queued rather than lost — the draft store
holds it, and the sync state is shown rather than hidden. What the app does not
do is pretend a queued product is saved.

## 10. Roadmap

See [ROADMAP.md](./ROADMAP.md) for phasing. In short: Phase 1 is everything in
this document that is built; Phase 1.5 wires the live OCR/embedding providers and
barcode lookup; Phase 2 adds retailer integrations, family workspaces and claim
submission — all of which the data model already accommodates.
