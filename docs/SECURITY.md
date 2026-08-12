# Security

The data in this app is more sensitive than it first appears. Receipts carry
names, addresses, card fragments and purchase histories; taken together they are
a detailed picture of a household. The threat model reflects that.

## Threat model

| Threat | Mitigation |
| --- | --- |
| A user reads another user's products or documents | RLS on every table, default deny; Storage paths authorised on the owner segment; UUID keys |
| A patched client grants itself a paid plan | `subscriptions` has no client INSERT/UPDATE policy; entitlement is written only after server-side store verification |
| A patched client exceeds its product limit | `enforce_product_limit()` trigger in Postgres, independent of any client check |
| A patched client fabricates a favourable AI verdict | `ai_analyses` has no client INSERT policy; verdicts are only ever server-written |
| A stolen device yields auth tokens | Sessions in Keychain / Keystore, never AsyncStorage; optional biometric lock |
| A leaked document URL | Private buckets; signed URLs only, 5-minute expiry |
| Prompt injection via an uploaded warranty PDF | Structural delimiters + output schema validation + citation requirement (see AI.md) |
| Credentials extracted from the binary | Only the Supabase anon key ships; every privileged key lives in Edge Function secrets |
| Abuse of expensive endpoints | Postgres-backed rate limiting on OCR, coverage analysis and uploads |
| PII leaking into logs or crash reports | Redaction allowlist in `logger.ts`; Sentry `beforeSend` strips request bodies and breadcrumb data |

## Authorisation

**Every table has RLS enabled and denies by default.** Frontend filtering is a
convenience; it is never the control. The concrete requirement: user A must not
be able to retrieve product B belonging to user B even with a valid session and a
guessed id. That is why ids are UUIDs and why every policy keys off `auth.uid()`.

Three tiers of policy:

1. **User-owned** — full CRUD, scoped by workspace membership or `owner_id`.
2. **Reference data** — SELECT for `authenticated`, no write policy.
3. **Backend-owned** — SELECT for the owner, *no INSERT policy at all*.
   `subscriptions`, `ai_analyses`, `notifications` and `ocr_jobs` are in this
   tier. service-role bypasses RLS, so Edge Functions still write them.

Column grants close the last gap. Row policies alone would let a hand-crafted
PostgREST call rewrite `owner_id` or an AI verdict while passing the row check:

```sql
revoke update (owner_id, workspace_id, created_at) on products from authenticated;
revoke update (owner_id, product_id, snapshot)     on claims   from authenticated;
revoke update on notifications from authenticated;
grant  update (read_at) on notifications to authenticated;
```

## Secrets

| Secret | Where it lives | Ships in the app? |
| --- | --- | --- |
| Supabase URL, anon key | `EXPO_PUBLIC_*` | Yes — safe, RLS-protected |
| Supabase service-role key | Edge Function secrets | **Never** |
| Anthropic API key | Edge Function secrets | **Never** |
| Apple App Store Server key | Edge Function secrets | **Never** |
| Google service account | Edge Function secrets | **Never** |
| Scheduler shared secret | Vault + Edge Function secrets | **Never** |

Anything in `EXPO_PUBLIC_*` is readable from the IPA/APK by anyone who cares to
look. Treat every one of those values as published. `.env.example` states this
explicitly, and `supabase/.env.example` is deliberately a separate file so the
two sets are never confused.

## Token storage

`lib/storage.ts` provides two tiers, and the split is enforced by having two
different function names:

- `getItem`/`setItem` — AsyncStorage, for preferences (theme, locale,
  onboarding seen).
- `secureGet`/`secureSet` — Keychain / Keystore, for anything that grants
  access.

The Supabase session uses the secure tier. A refresh token in plaintext on disk
is a device-theft vulnerability and is readable on a rooted Android device.
SecureStore rejects values over ~2KB on some platforms, so the session is chunked
across keys; a missing chunk is treated as absent rather than returning a
truncated token.

## Purchase verification

The client reports a purchase; it never grants one.

1. The app sends the store's own proof — an Apple signed JWS transaction or a
   Google purchase token.
2. `verify-purchase` validates it with Apple or Google directly.
3. Only then is `subscriptions` written, by service-role.

Replay protection: a transaction already bound to one account cannot migrate to
another. `verify-purchase` looks up the existing row by
`(provider, original_transaction_id)` and returns `409` if the user differs, with
an audit entry. Without this, one purchase could be replayed to entitle many
accounts.

**Known gap.** Apple JWS signature verification against the Apple Root CA
certificate chain is marked `TODO(billing)` in `verify-purchase/index.ts`. The
payload is decoded and the business rules applied, but the signature is not yet
cryptographically verified. This must be completed before production billing.
Until then the function refuses sandbox transactions when configured for
production, which limits but does not eliminate the exposure.

## Rate limiting

Backed by Postgres rather than in-memory, because Edge Functions run in many
isolates and a per-isolate counter is bypassed by retrying until a cold start.

| Endpoint | Limit |
| --- | --- |
| Coverage analysis | 20 / hour / user |
| OCR extraction | 40 / hour / user |

Auth rate limiting is handled by Supabase Auth's own configuration.

The limiter fails *open* on an infrastructure error — a database blip should not
lock users out of the product. That is a deliberate availability-over-strictness
choice for these endpoints; it would be the wrong choice for authentication.

## File validation

- MIME allowlist, enforced in three places: the app, the Postgres check
  constraint, and the bucket configuration.
- 25 MB cap for documents, 10 MB for images, enforced in the same three places.
- The size check runs *before* the bytes are read, so an oversized file is
  rejected without pulling it into memory.
- Images are re-encoded through `expo-image-manipulator` before upload, which
  strips EXIF (including GPS coordinates) as a side effect and roughly halves the
  file size.

## Logging and crash reporting

`logger.ts` holds a forbidden-key list — `password`, `token`, `receipt`,
`ocrText`, `clauseText`, `serialNumber`, `email`, `address`, `phone` and
others — and redacts any context key containing one of them before it reaches a
sink.

Sentry is optional (no DSN, no transmission) and configured with
`sendDefaultPii: false`. `beforeSend` strips request bodies, cookies, headers and
breadcrumb data, and reduces the user object to an id. Console breadcrumbs are
dropped entirely, since they can capture logged objects.

Analytics events are a closed TypeScript union with typed properties. Counts,
enums and booleans only — no product names, no prices, no document content.
Knowing that a user scanned a receipt is useful; knowing what it said is
surveillance.

## Audit trail

`audit_logs` records deletions, exports, subscription changes, verification
failures and flagged injection attempts. Metadata never contains document
contents. Account deletion writes a de-identified completion record with a null
actor — retaining proof that a deletion happened, containing no personal data, is
what makes the process accountable.

## Account deletion

Runs entirely server-side in `delete-account`, in this order:

1. Purge Storage objects under `<ownerId>/`. **First**, because once the auth
   user is gone the RLS-derived ownership of those paths is unrecoverable and the
   files would be orphaned permanently.
2. Delete the auth user. Everything cascades from `user_profiles`.
3. Write the de-identified audit record.

The typed-email confirmation is a speed bump against a mis-tap, not the
authorisation — the JWT already proves identity.

## Permissions

Requested contextually, never at launch:

| Permission | Requested when | Why not earlier |
| --- | --- | --- |
| Camera | The user taps "Scan receipt" | A cold prompt gets denied, permanently |
| Photos | Via the system picker | Returns only the chosen asset; no library-wide access is ever requested |
| Notifications | After the first product is added | The value is self-evident at that moment |
| Location | Never required | Country is a picker; the app is fully functional without it |

`READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` are explicitly blocked in
`app.config.ts`.

## Checklist before production

- [ ] Complete Apple JWS certificate chain verification
- [ ] Configure App Store Server Notifications V2 and Play RTDN endpoints
- [ ] Set every Edge Function secret in staging and production
- [ ] Rotate the anon key if a service-role key was ever exposed
- [ ] Run `supabase db lint` and review every RLS policy against this document
- [ ] Penetration test the cross-tenant cases: guessed product ids, guessed
      storage paths, forged purchase payloads, direct PostgREST writes to
      backend-owned tables
- [ ] Confirm no `EXPO_PUBLIC_*` value is privileged
