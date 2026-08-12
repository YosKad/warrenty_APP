# Roadmap

## Phase 1 — MVP

### Built

| Area | State |
| --- | --- |
| Project foundation | Expo SDK 57, TypeScript strict, ESLint/Prettier, Jest, three environments |
| Design system | Semantic light/dark tokens, 8pt spacing, type scale, 18 components |
| Navigation | Expo Router: onboarding, auth, five tabs, product detail, add flows, coverage, settings |
| Authentication | Email + password, Sign in with Apple, Google OAuth (PKCE), reset, sign out (local + all devices), account deletion |
| Database | Full schema, RLS on every table, RPCs, private storage buckets, cron |
| Home | Summary counts, single attention card, recent products, quota line |
| Products | List, search, status filters, detail with warranty card and timeline |
| Add product | Method chooser, manual form, receipt capture, extraction review |
| Warranty engine | Status, expiry, extensions, provenance and confidence — 92 tests |
| Documents | Upload with compression and hashing, signed-URL viewing, duplicate detection |
| Notifications | Server-side scheduler, in-app inbox, per-user preferences |
| Subscriptions | Entitlement model, quota enforcement in Postgres, paywall, restore, management |
| Coverage AI | Full RAG pipeline with schema validation and injection isolation |
| Settings | Notifications, appearance, language, country, export, delete account, legal |
| i18n | English + Hebrew with RTL |

### Remaining to ship

1. **Apple JWS certificate verification** — blocking for production billing.
2. **`expo-iap` wiring** — connect `getOfferings` and the purchase flow to
   StoreKit / Play Billing. The paywall renders its empty state until this lands.
3. **Store notification webhooks** — the two endpoints that consume App Store
   Server Notifications and Play RTDNs into `subscription_events`.
4. **OCR and embedding providers** — credentials and provider selection. Both
   pipelines already fail cleanly when unconfigured.
5. **Document viewer screen** — `/document/[id]` is routed from product detail
   but not yet implemented.
6. **Barcode screen** — `/add/barcode` is routed and flagged off.
7. **`export-data` Edge Function** — the client call exists; the function does
   not.
8. **Assets** — real icon, splash and notification icon.
9. **E2E** — Maestro flows for signup, add product, and the free-limit paywall.

## Phase 1.5 — Making it feel automatic

Once the MVP is stable and instrumented:

- **Barcode lookup.** EAN/UPC → product identity via `ProductRecognitionProvider`.
- **Better OCR.** Provider comparison against a labelled receipt corpus, tuned
  per market. Hebrew receipts specifically.
- **Automatic warranty lookup.** Seed the policy database for the top ~50 brands
  in the launch markets. This is editorial work, not engineering — and it is what
  makes the app feel like it *knows* things.
- **Coverage AI at scale.** Ingest and embed manufacturer warranty PDFs.
- **Service provider discovery.** Populate importers and service locations for
  the launch markets.
- **Claim preparation.** The guided flow assembling everything a service provider
  will ask for.

The abstraction seams for all of this already exist:
`ProductRecognitionProvider`, `WarrantyDataProvider`, and the feature flag table.

## Phase 2 — Platform

- Retailer integrations (Amazon, Best Buy, local electronics chains) importing
  purchases directly.
- Email import — a personal forwarding address that detects purchases.
- Family workspaces. The schema already supports this: add members to a
  workspace, and the existing RLS policies handle the rest.
- Business accounts for offices, fleets, rental properties and IT equipment.
- Claim submission directly to service providers.
- Service appointment booking.
- Warranty transfer on resale.
- QR warranty card for use at a repair counter.
- Extended warranty marketplace and insurance integration.

## What we are deliberately not doing yet

**A monorepo.** One consumer today; the workspace tooling would cost more than it
returns. Migration path documented in ARCHITECTURE.md.

**An admin dashboard.** The data model supports it fully — verification states,
audit logs, source provenance, moderation fields are all in place. Building the
UI before there is warranty data worth moderating would be premature.

**Local notification fallback.** Server-side scheduling is correct; a local
fallback would produce duplicate reminders for marginal benefit.

**Realtime.** Warranty data changes rarely. Polling on foreground is sufficient
and cheaper.

## Success measures

The events in `lib/analytics.ts` map to the questions that actually matter:

| Question | Signal |
| --- | --- |
| Do people finish setting up? | `signup_completed` → `product_added` conversion |
| Is adding a product easy enough? | Time to first `product_added`; method breakdown |
| Does automation work? | `product_detected` / `warranty_detected` acceptance rate |
| Do reminders land? | `warranty_alert_opened` rate |
| Is coverage analysis the differentiator we think it is? | `coverage_analysis_completed` per active user, and its correlation with `subscription_started` |
| Is the paywall fair? | `paywall_viewed` → `subscription_started`, and churn after |

None of these events carry product names, prices or document content.
