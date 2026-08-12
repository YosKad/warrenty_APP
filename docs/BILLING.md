# Billing

## Model

Freemium, three tiers.

| Plan | Products | Adds |
| --- | --- | --- |
| Free | 3 | Manual entry, receipt storage, expiry reminders |
| Plus | 20 | Coverage checks, receipt scanning, automatic warranty detection, service provider lookup, export |
| Pro | Unlimited | Priority coverage checks, full warranty archive, advanced claim help |

Free is deliberately usable. Three products is enough to prove the app works —
someone who records their TV, laptop and washing machine gets real value and a
real reason to add the fourth. Crippling Free to force an upgrade produces
uninstalls, not subscriptions.

## Entitlements, not plan names

Feature checks ask "does this user have `ai_coverage`?", never "are they on
Plus?".

```ts
product_limit          number | null   // null = unlimited
unlimited_products     boolean
ai_coverage            boolean
smart_scan             boolean
advanced_notifications boolean
provider_lookup        boolean
priority_analysis      boolean
document_export        boolean
```

The plan → entitlement map lives in `src/domain/entitlements.ts` (for rendering)
and in `product_limit_for_plan()` in Postgres (for enforcement). Pricing, limits
and plan composition can change server-side without an app release, and support
can grant a single capability to one account.

## Prices come from the store

There is no price string anywhere in the codebase. `getOfferings` returns what
StoreKit and Play Billing report — already localised, already in the right
currency, already reflecting any regional pricing or introductory offer the user
qualifies for.

A hard-coded "$5/month" is wrong in most countries and is grounds for rejection
in both stores.

The only commercial constants in the app are SKU identifiers, which carry no
price:

```
mywarranty_plus_monthly
mywarranty_plus_annual
mywarranty_pro_monthly
mywarranty_pro_annual
```

The SKU → plan map exists in both the client (for the paywall) and
`verify-purchase` (authoritative).

## Server-authoritative entitlement

```
app → store purchase → proof (Apple JWS / Google purchase token)
    → verify-purchase Edge Function
    → validates directly with Apple / Google
    → writes `subscriptions` as service-role
    → app re-reads its entitlement
```

`subscriptions` has a SELECT policy for its owner and **no INSERT or UPDATE
policy**. A patched client can call the endpoint with any payload; without a
signature Apple's keys verify or a token Google's API recognises, it gets
nothing.

Replay protection: a transaction already bound to one account cannot be moved to
another. `verify-purchase` looks up `(provider, original_transaction_id)` and
returns `409` with an audit entry if the user differs.

## Subscription state

```sql
user_id, plan, status, provider,
store_product_id, original_transaction_id, latest_transaction_id,
started_at, current_period_start, expires_at,
auto_renew, cancelled_at, grace_period_expires_at,
is_trial, environment, last_verified_at
```

`original_transaction_id` is the subscription's stable identity across renewals,
upgrades and refunds — the join key for every store notification.

### Statuses that still entitle

`active`, `in_trial`, `in_grace_period`, `in_billing_retry`.

Grace period and billing retry deliberately grant access. The user's card failed;
they have not cancelled. Locking them out of their own warranty records over a
payment hiccup is hostile and reliably churns people who would otherwise have
fixed their card. `effective_plan()` and `planFromSubscription()` both encode
this, and it is covered by tests.

## Lifecycle events

Every App Store Server Notification V2 and Play Real-time Developer Notification
is appended to `subscription_events` **before** it mutates `subscriptions`,
unique on the store's own event id. Both stores retry and will happily deliver
the same notification twice, so processing must be idempotent — appending first
and keying on the event id is what makes it so.

| Event | Effect |
| --- | --- |
| `SUBSCRIBED`, `DID_RENEW` | `active`, extend `expires_at` |
| `DID_CHANGE_RENEWAL_STATUS` | Update `auto_renew`, set `cancelled_at` |
| `DID_FAIL_TO_RENEW` (grace) | `in_grace_period`, set `grace_period_expires_at` |
| `DID_FAIL_TO_RENEW` (retry) | `in_billing_retry` |
| `EXPIRED` | `expired` → entitlement drops to Free |
| `REFUND`, `REVOKE` | `revoked` → entitlement drops immediately |
| `DID_CHANGE_RENEWAL_PREF` | Plan change at period end |

An hourly cron marks subscriptions expired when their date has passed and no
notification arrived — a safety net for a missed webhook, with 24 hours of slack
so a slightly late renewal does not briefly downgrade a paying user.

## Upgrade, downgrade, expiry

**Upgrade (Plus → Pro).** Handled by the store's own upgrade flow with
proration. The renewal notification updates `plan`.

**Downgrade (Pro → Plus).** Takes effect at period end; the user keeps Pro until
then.

**Expiry.** Entitlement drops to Free. This is where the rules that matter live:

> A user with 15 products whose subscription expires keeps all 15. They can
> view, edit, export and delete every one. They simply cannot add a sixteenth
> until they upgrade.

`enforce_product_limit()` fires on INSERT only — never on SELECT or UPDATE.
`isOverLimit()` lets the UI explain the state honestly ("you have 15 products; on
Free you can view and edit them all, but you won't be able to add more") rather
than showing "-12 slots left". This is tested explicitly.

Never hold user data hostage. It is both wrong and a reliable way to earn a
one-star review and a chargeback.

## The paywall

`src/features/paywall/PaywallSheet.tsx`.

Three deliberate choices:

- **Prices from `offerings`.** If the store has not returned products, the sheet
  says so rather than inventing numbers.
- **No countdown, no scarcity, no dark patterns.** The reason to upgrade is that
  the user has more than three products, stated plainly.
- **The draft survives.** When the sheet opens because a limit was hit, the
  product form behind it keeps everything the user typed, and the sheet says so.
  Discarding someone's input to show them a purchase prompt loses the sale *and*
  the user.

Required elements, all present: renewal terms, restore purchases, manage
subscription, privacy policy and terms links.

## Restore purchases

Required by App Store review, and genuinely needed — a user on a new phone
expects their plan back.

Because entitlement lives on the server keyed to the account, restore mostly
means: sign in, re-verify whatever the store still knows about, re-read our own
record. Exposed in Profile → Subscription and on the paywall.

## Testing

**iOS** — StoreKit configuration file for the simulator; sandbox testers for
device testing. Sandbox subscriptions renew on an accelerated clock (1 month =
5 minutes), which makes the full renew/expire/grace cycle testable in an hour.

**Android** — licence testers in the Play Console; test SKUs renew on a similarly
accelerated schedule.

Cases that must be covered before release:

- [ ] Purchase Plus, verify entitlement appears within one refresh
- [ ] Reinstall, sign in, restore
- [ ] Upgrade Plus → Pro
- [ ] Let a subscription expire; confirm existing products stay readable and
      editable, and that adding is blocked
- [ ] Refund; confirm entitlement drops
- [ ] Grace period; confirm access is retained and the banner appears
- [ ] Replay a purchase token against a second account; confirm `409`

## Never

- Store card numbers. We never see them; the stores handle payment.
- Implement custom card handling for mobile subscriptions. Both stores forbid it
  for digital goods.
- Trust the client's claim about its plan.
- Hard-code prices.
- Block reads or exports when a subscription lapses.
