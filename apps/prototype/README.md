# MY Warranty — interactive prototype

A playable version of the app that runs in any browser. Two files, no build
step, no dependencies, no network calls.

```bash
open apps/prototype/index.html          # macOS
xdg-open apps/prototype/index.html      # Linux
```

Or serve it: `cd apps/prototype && python3 -m http.server 8080`

## Why this exists

The real Expo app can't run in a browser — Sign in with Apple, StoreKit,
camera and secure storage have no web equivalent, and there's no live backend
yet. This gives you something to actually click through in the meantime:
stakeholders, a partner, a designer, or you checking a flow feels right before
it's built for real.

## What to try

1. **Add a product.** Home → Add → Enter manually. Pick a category and watch it
   suggest a typical warranty length; type a purchase date and watch the end
   date compute live.
2. **Hit the Free limit.** You start on Free with 3 products. Fill in a fourth
   completely, then press Save. The paywall opens — and *everything you typed is
   still there behind it*. Upgrade from the sheet and it saves immediately. That
   behaviour is the reason this prototype exists.
3. **Check coverage.** Open a product still in warranty → Report a problem.
   Describe a fault ("the screen has vertical lines") versus damage ("I dropped
   it") and watch the verdict change. Every verdict cites a clause.
4. **Read the Protection Score.** Home leads with one number and the actions
   that raise it. Each action states what it is worth; open the product it
   belongs to and *Claim readiness* shows the same score broken into the facts
   it is made of. The maths is the app's own — `src/domain/protection.ts`,
   deterministic, no model involved.
5. **Read your warranty.** Open the Samsung and look at *Your warranty*: the
   term, who honours it, who repairs it, where the information came from, and
   how sure we are. Two demo sources disagree about the length on purpose, so
   the conflict state is reachable.
6. **See what's covered.** Coverage, exclusions, special conditions and claim
   requirements, each one tappable through to the verbatim clause with its
   section and page. Nothing on that screen is generated to fill a section out.
7. **Describe a fault.** "There is a vertical black line on the right of the
   screen" → the check asks whether it followed an impact rather than guessing,
   and only then returns a verdict citing Section 4.2.
8. **Switch language.** Profile → Language → עברית. The whole layout mirrors;
   serial numbers, model codes, sections and percentages stay left-to-right.
9. **Switch theme and plan.** Profile → Appearance and Subscription.

The warranty policies, clauses and organisations in the prototype mirror
`supabase/seed_demo_warranty.sql` and are **demonstration data** — no real
Samsung, Apple or Dyson warranty text appears anywhere in this repository.

Your data lives in `localStorage` and survives a reload. Reset it from
**Profile → Reset all data**.

## What's real and what isn't

**Real** — ported directly from `apps/mobile/src/domain`:

- Calendar-date warranty arithmetic, including month-end clamping (31 Jan + 1
  month = 28 Feb) and the rule that the final day of cover still counts as
  covered
- Status thresholds, days remaining and the timeline progress bar
- Plan limits and the paywall trigger, including the draft-survives rule
- The "we never invent a warranty" rule — leave the duration blank and the
  status stays *unknown* rather than defaulting to twelve months
- Form validation
- Locale-aware dates and currency, and real RTL

**Simulated** — because there's no backend or model behind a static file:

- Sign-in is skipped entirely
- Receipt and barcode scanning aren't wired up; those methods say so
- **The coverage check is keyword-driven, not a model call.** It's negation-aware
  (so "it was never dropped" doesn't read as damage) and it always cites a
  clause, but it is not the RAG pipeline described in `docs/AI.md`
- Plan changes are instant and local. In the real app the store confirms the
  purchase and the server decides entitlement — the client can never grant
  itself a plan

There's an **About this prototype** row in Profile that says the same thing
in-app, so nobody you share this with is misled about what they're looking at.

## Relationship to the real app

The colours are the literal semantic tokens from
`apps/mobile/src/theme/semantic.ts`, and the spacing and type scale come from
`tokens.ts`. If a token changes in the app, this file needs the same edit — it's
a deliberate duplicate, not an import, because the point was zero build tooling.

`app.js` is organised in the same order as the real source: domain, i18n, state,
formatting, screens, actions.
