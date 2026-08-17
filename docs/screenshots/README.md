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

`MacBook Air 13-inch M4` is the phase's pinned regression. Stage A resolves it to
the canonical `MacBook Air M4` and stage B corroborates through the verified
alias; the policy it reaches, `APPLE-LW-2024.09`, is linked by `model_id` and
could never have been found by the `M4%` pattern that failed before Phase I.5.

The policy shows as `unverified` because the pilot corpus is fixtures. That chip
is the system telling the truth about its own data, and is worth leaving in the
picture.

## Reproducing them

Both tools take an optional `initialResult` prop for exactly this. With a local
database seeded (`scripts/local-db.sh reset`), render them on a throwaway page
with a result computed from `probe_models` + `resolveModel`, serve it with
`next start`, and screenshot with the bundled Chromium at
`/opt/pw-browsers/chromium`.
