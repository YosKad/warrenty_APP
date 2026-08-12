# Store release

## Environments

Three, each with its own Supabase project, storage, keys and bundle identifier —
so all three can be installed side by side and nothing is ever tested against
production data.

| | Bundle id | Scheme |
| --- | --- | --- |
| Development | `com.mywarranty.app.dev` | `mywarranty-dev` |
| Staging | `com.mywarranty.app.stg` | `mywarranty-stg` |
| Production | `com.mywarranty.app` | `mywarranty` |

Selected by `APP_ENV` in `app.config.ts`.

## Build

```bash
cd apps/mobile
cp .env.example .env.local        # fill in
npx expo prebuild --clean
npx expo run:ios                  # or run:android
```

EAS for distribution builds. `eas.json` profiles map to the three environments.

## iOS

### App Store Connect

- [ ] Bundle id `com.mywarranty.app` registered
- [ ] Sign in with Apple capability enabled (required: the app offers Google
      sign-in, so Apple's guidelines make Apple sign-in mandatory)
- [ ] Push notification capability + APNs key
- [ ] Subscription group "MY Warranty" with the four SKUs
- [ ] Localised subscription display names and descriptions
- [ ] App Store Server Notifications V2 pointed at the `verify-purchase` webhook
- [ ] App Store Server API key (issuer id, key id, .p8) in Edge Function secrets

### Review notes

Both stores read these carefully for a subscription app.

**Demo account.** Reviewers must be able to see the paid experience. Provide an
account pre-populated with 5–6 products and a Pro entitlement granted directly in
the database (not via a purchase), plus the credentials in App Review
Information.

**Account deletion.** Required and present: Profile → Delete account, two taps
from the root. Note in the review information that cancelling an active
subscription is handled separately in the App Store, since we cannot do it on the
user's behalf — the app states this on the deletion screen.

**Permissions.** All usage descriptions are in `app.config.ts` and explain the
benefit rather than the mechanism. None is requested at launch. Location is never
required and the app is fully functional without it.

**Coverage analysis.** Worth pre-empting in the review notes: the app assesses
warranty coverage from documentation and always displays a disclaimer that it is
informational and not a guarantee of any claim outcome. The app does not present
itself as a warranty provider.

### Privacy nutrition label

| Data | Collected | Linked to user | Used for tracking |
| --- | --- | --- | --- |
| Email | Yes | Yes | No |
| Name | Yes | Yes | No |
| Purchase history (products the user records) | Yes | Yes | No |
| Photos / documents | Yes | Yes | No |
| Product interaction | Yes | Yes | No |
| Crash data | Yes (if Sentry enabled) | No | No |
| Location | **No** | — | — |

No tracking, no third-party advertising SDKs, no data sold or shared.

## Android

### Play Console

- [ ] Package `com.mywarranty.app`
- [ ] Google Play Billing enabled, four subscription SKUs with base plans
- [ ] Real-time Developer Notifications → Pub/Sub topic → `verify-purchase`
- [ ] Service account with Android Publisher access; JSON base64-encoded into
      Edge Function secrets
- [ ] FCM configured for push
- [ ] Target API 36

### Data safety form

Mirrors the iOS privacy label. Declare: personal info (name, email), photos and
videos, purchase history, app activity. Encrypted in transit; users can request
deletion in-app.

### Requirements

- [ ] Account deletion reachable in-app *and* via a web URL (Play requires the
      latter separately — point it at the support page with instructions)
- [ ] Data safety form matches actual behaviour
- [ ] Subscriptions declare their renewal terms in the listing
- [ ] Predictive back gesture supported (enabled in `app.config.ts`)

## Store listing

**Name.** MY Warranty

**Subtitle / short description.** Know what you own. Know what's covered.

**Description opening.** Lead with the problem, not the feature list:

> You bought it, it broke, and you have no idea whether it's still under
> warranty. MY Warranty remembers what you own, when cover ends, and what your
> warranty actually says — so you find out before you pay for a repair you
> didn't need to.

**Screenshots (6).** Home with the summary and an ending-soon alert; the product
detail warranty card; the add flow; a coverage result with its cited clause; the
alerts inbox; the paywall. Show real-looking products, not lorem ipsum.

**Keywords.** warranty, receipts, appliances, guarantee, product registration,
repair, home inventory.

## Required URLs

Configured via `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`,
`EXPO_PUBLIC_SUPPORT_URL`, surfaced in Profile and on the paywall. All three must
be live and reachable before submission — a dead privacy policy URL is an
automatic rejection.

## Versioning

Semantic version in `app.config.ts` (`version`). Build numbers
(`ios.buildNumber`, `android.versionCode`) increment on every store upload, even
for a rejected build.

## Pre-submission checklist

**Functional**

- [ ] Sign up, sign in, forgot password, sign out
- [ ] Sign in with Apple (device, not simulator)
- [ ] Add a product manually; confirm warranty status and reminders
- [ ] Free limit: add a fourth product, confirm the paywall opens **and the draft
      survives**
- [ ] Purchase, restore, upgrade, expire (sandbox accelerated clock)
- [ ] Upload a receipt; confirm the review screen appears before anything saves
- [ ] Coverage check on a product with warranty data, and on one without
- [ ] Delete a product; delete an account
- [ ] Airplane mode: previously-loaded products still readable

**Localisation**

- [ ] Switch to Hebrew; confirm the restart prompt and full RTL layout
- [ ] Serial numbers and phone numbers read left-to-right in the RTL layout
- [ ] Dates render per locale in both languages

**Accessibility**

- [ ] VoiceOver pass over Home, product detail and the paywall
- [ ] TalkBack pass over the same
- [ ] Largest Dynamic Type setting on every primary screen
- [ ] Reduce Motion on

**Store**

- [ ] Icons, splash and screenshots for every required size
- [ ] Privacy label / data safety form completed
- [ ] Demo account created and credentials supplied
- [ ] Subscription metadata complete in both consoles
- [ ] Privacy, terms and support URLs live

**Security** — see the checklist at the end of [SECURITY.md](./SECURITY.md). The
Apple JWS signature verification gap must be closed before production billing.

## Known gaps before v1.0

These are tracked deliberately rather than hidden:

1. **Apple JWS certificate chain verification** — `TODO(billing)` in
   `verify-purchase/index.ts`. Blocking for production billing.
2. **Live OCR and embedding providers** — the pipelines are complete and fail
   cleanly when unconfigured; the provider credentials are not yet wired.
3. **Store notification webhook handlers** — `subscription_events` and the
   processing rules are specified in BILLING.md; the endpoints themselves are not
   yet implemented.
4. **In-app purchase UI wiring** — `subscriptionService` and the paywall are
   complete, but `expo-iap` is not yet connected to `getOfferings`, so the
   paywall currently renders its empty state.
