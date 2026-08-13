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
4. **Switch language.** Profile → Language → עברית. The whole layout mirrors;
   serial numbers, model codes and phone numbers stay left-to-right.
5. **Switch theme and plan.** Profile → Appearance and Subscription.

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
