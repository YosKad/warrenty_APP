# Screenshots

Real screenshots of the console's own components and stylesheet, rendered
against the local pilot corpus in PostgreSQL. Not mock-ups — but not a deployed
instance either: this environment has no Supabase project, so the two tools were
driven with a result computed by the same code paths the server actions use.

| File | What it shows |
| --- | --- |
| `model-resolver.png` | The Model Resolver on `MacBook Air 13-inch M4` — the parse, the reasoning, and both trusted candidates with their evidence |
| `resolution-tester.png` | One case traced through all eight stages, each with what it matched, where it came from, why, and its latency |
| `console.png` | The whole page, for the shell and the navigation |
| `app-dashboard.png` | The consumer app's home screen — Protection Score, what needs attention, recommended actions |
| `app-dashboard-he.png` | The same screen in Hebrew, right-to-left |
| `app-dashboard-dark.png` | The same screen in dark mode |
| `v3-language.png` | V3 revision 2 — Home, Product and Things side by side, light |
| `v3-language-dark.png` | The same three in dark |
| `v3-language-he.png` | The same three in Hebrew, right-to-left |
| `v3-home.png` | The V3 Home on its own, at device framing |

`MacBook Air 13-inch M4` is the phase's pinned regression. Stage A resolves it to
the canonical `MacBook Air M4` and stage B corroborates through the verified
alias; the policy it reaches, `APPLE-LW-2024.09`, is linked by `model_id` and
could never have been found by the `M4%` pattern that failed before Phase I.5.

The policy shows as `unverified` because the pilot corpus is fixtures. That chip
is the system telling the truth about its own data, and is worth leaving in the
picture.

The three `app-dashboard*` shots come from `apps/prototype`, the playable
prototype of the mobile app — the real Expo app cannot run in a browser, and the
prototype is what the V2 screens were designed and reviewed against. They are
rendered at 402x874 with a 3x pixel ratio, which is an iPhone's own geometry.

The four `v3-*` shots are a different kind of thing again: they come from
`apps/prototype/v3-preview.html`, which is a **static design preview**, not the
app and not the playable prototype. It exists so the direction in
`docs/V3_MAKEOVER_BRIEF.md` can be judged by eye. Nothing in it is wired to data,
and none of it has shipped.

They show revision 2 of the product model, not what is in `apps/mobile` today:
no Protection Score, no claim timeline. A product leads with **who services it,
what they cover and how long is left**, anything still missing is an open item
that closes either by being resolved or by being honestly refused, and things are
grouped by the room they are in.

Two honest gaps in what those images show. CSS `backdrop-filter` stands in for
iOS 26's Liquid Glass, which samples and refracts rather than only blurring — on
a device the material is livelier than this. And Inter stands in for SF Pro,
which is not installed here; Hebrew is set in Heebo, with the locale-aware
metrics the brief argues for in F7 rather than the Latin tracking the shipped app
currently applies to it.

## Reproducing them

Both tools take an optional `initialResult` prop for exactly this. With a local
database seeded (`scripts/local-db.sh reset`), render them on a throwaway page
with a result computed from `probe_models` + `resolveModel`, serve it with
`next start`, and screenshot with the bundled Chromium at
`/opt/pw-browsers/chromium`.
