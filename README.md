# MY Warranty

**Know what you own. Know what's covered.**

A personal warranty wallet for iOS and Android. Record what you buy once; the app
tracks when cover ends, understands what the warranty actually says, and tells
you who to contact when something breaks.

## The idea

People buy dozens of products and lose track of receipts, purchase dates,
warranty lengths and who honours them. They end up paying for repairs that were
covered, or discovering the warranty lapsed a month ago.

MY Warranty is the digital wallet for that. Adding a product takes about thirty
seconds; from then on the app does the remembering.

The product's credibility rests on one property: **it never claims to know
something it does not know.** A wrong warranty date, or a confident "you're
covered" that a manufacturer later refuses, is worse than no answer — the user
acts on it and loses money. Every design decision follows from that.

## Stack

React Native (Expo SDK 57) + TypeScript · Supabase (Postgres, Auth, Storage,
Edge Functions, pgvector) · TanStack Query · Zod · i18next

## Getting started

```bash
git clone <repo> && cd warrenty_APP

# Backend
supabase start
supabase db reset                 # migrations + seed data

# App
cd apps/mobile
npm install
cp .env.example .env.local        # fill in your Supabase URL and anon key
npx expo prebuild
npx expo run:ios                  # or run:android
```

Expo Go will not work — the app uses Sign in with Apple, StoreKit / Play Billing,
camera and secure storage, all of which need a development build.

## Commands

```bash
npm start          # dev server (dev client)
npm run ios        # build and run on iOS
npm run android    # build and run on Android
npm test           # jest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

## Layout

```
apps/mobile/
  app/           Expo Router routes
  src/theme/     design tokens
  src/ui/        design-system components
  src/domain/    pure business logic (no I/O, no React) — heavily tested
  src/services/  the only modules that talk to Supabase
  src/hooks/     TanStack Query bindings
  src/i18n/      English + Hebrew
supabase/
  migrations/    schema, RLS, RPCs, cron
  functions/     Edge Functions (Deno)
docs/            architecture, database, billing, AI, security, release
```

## Documentation

| Document | What's in it |
| --- | --- |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Stack, layering, data model overview, the warranty engine, tradeoffs |
| [DATABASE.md](./docs/DATABASE.md) | Every table, RLS policies, RPCs, storage layout, cron |
| [DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md) | Tokens, typography, components, motion, accessibility, RTL |
| [BILLING.md](./docs/BILLING.md) | Plans, entitlements, store verification, lifecycle, downgrade rules |
| [AI.md](./docs/AI.md) | RAG pipeline, output contract, prompt-injection defence, cost control |
| [SECURITY.md](./docs/SECURITY.md) | Threat model, RLS, secrets, rate limiting, known gaps |
| [STORE_RELEASE.md](./docs/STORE_RELEASE.md) | Environments, store setup, review notes, checklists |
| [ROADMAP.md](./docs/ROADMAP.md) | What's built, what's left, what's deliberately deferred |

## Principles

**Never invent a warranty.** If we do not know the duration, the status is
`unknown` and we ask. A plausible guess that turns out wrong when someone tries
to claim is the worst thing this app could do.

**Always show where information came from.** Anything derived rather than typed
carries its source and confidence, and anything low-confidence asks for
confirmation before the app treats it as settled.

**Never claim something is covered.** The strongest verdict the app can give is
"likely covered", it must cite a real clause from a real document, and the
disclaimer is always visible. We are not the warranty provider.

**Never hold data hostage.** A lapsed subscription restricts adding new products.
It never blocks reading, editing, exporting or deleting what someone already
saved.

**Server decides.** Entitlements, quotas, subscription state and AI verdicts are
all server-authoritative. The client renders them; it never asserts them.

## Status

Phase 1 foundation is implemented: design system, warranty engine, database with
RLS, services layer, screens, English + Hebrew with RTL, and the Edge Functions
for coverage analysis, billing verification, extraction and reminders. 92 domain
tests pass; `tsc --noEmit` is clean.

Remaining work before store submission is listed in
[ROADMAP.md](./docs/ROADMAP.md) and the gaps section of
[STORE_RELEASE.md](./docs/STORE_RELEASE.md) — most notably Apple JWS signature
verification, `expo-iap` wiring, and the store notification webhooks.
