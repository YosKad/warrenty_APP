# MY Warranty V3 — End-to-End Makeover Brief

Technical and visual. Written against the shipped V2 + Phase G/H/I/I.5 codebase, not
against a memory of it: every claim about what exists was checked in the files named
beside it.

This document is the brief, not the implementation. It ends with a phase plan and two
questions that need answering before any of it starts.

---

## 0. What this brief is allowed to claim

Two honesty notes, because the brief rests on them.

### 0.1 The research is partly second-hand

Network egress from this environment is an allowlist, not open. Verified during this
session:

| Source | Result |
| --- | --- |
| `WebSearch` | works — returns synthesised summaries with links |
| `raw.githubusercontent.com` | works — full file contents |
| `developer.apple.com/design/human-interface-guidelines/materials` | reachable, but the body is client-rendered; only the `<title>` came back |
| `docs.expo.dev` | blocked by the proxy |
| `en.wikipedia.org`, `www.learnui.design` | blocked by the proxy |

So **Apple's Human Interface Guidelines were not read first-hand.** What is written
below about Liquid Glass comes from: search-result summaries of the HIG and of press
coverage, and a full read of the community reference
[`conorluddy/LiquidGlassReference`](https://github.com/conorluddy/LiquidGlassReference),
which quotes the HIG directly and documents the SwiftUI API. The `expo-glass-effect`
prop table was read from that package's own TypeScript source on GitHub, which is
first-hand.

**Before implementation, someone with a browser should confirm** the material rules in
§4.2 against the real HIG page. Everything in §4.2 is stated as a rule we intend to
follow; none of it is stated as a quotation from Apple.

One number is repeated here that should be treated as unverified third-party
measurement, not fact: the reference repo reports *"13% battery drain vs. 1% in iOS 18
(iPhone 16 Pro Max testing)"* for heavy glass use. Nobody has reproduced that here. It
is in this brief only because it justifies a performance budget (§4.7), and a budget is
worth having even if the number is wrong.

### 0.2 The skills were offered, not silently installed

The request was to install front-end skills. `SearchSkills` against the account's
enabled skills returned **zero** results for design or front-end keywords — there was
nothing to enable. `SearchPlugins` found three relevant bundles and an install card was
rendered for them:

| Plugin | Publisher | Why |
| --- | --- | --- |
| `frontend-design` | Anthropic | the core UI/UX implementation skill |
| `Design` | Anthropic | `design-critique`, `design-system`, `accessibility-review`, `ux-copy`, `design-handoff` |
| Skills For Real React/React Native Engineers | community | `ui-surfaces`, `ui-motion`, `ui-typography`, `native-feel`, `reanimated-*`, `skia` |

Installing a plugin is the account holder's action, not mine — the card has to be
accepted. At the time of writing, `ListPlugins` shows only `productivity` and
`cowork-plugin-management` enabled, so **the skills are not yet active** and nothing in
this brief was produced with their help. The third one is community-published and
`privileged` reach (it carries agents and hooks); that is worth a deliberate decision
rather than a reflex yes.

---

## 1. Technical audit

### 1.1 What is genuinely good and must not be touched

Naming these first, because a makeover is also a list of things to leave alone.

- **`packages/domain`** — model parsing, six-stage matching, protection scoring and
  resolution live in one platform-free package with 140 tests. This is the asset. Every
  screen change below is a change to how it is *presented*, never to what it decides.
- **The security floor** — RLS default-deny, `security invoker` publication guards,
  admin roles enforced in the database rather than the console, private documents,
  server-authoritative entitlements. 75 SQL assertions across 5 suites, run from zero
  against real PostgreSQL. V3 adds surfaces on top of this and changes none of it.
- **Three-layer tokens** — `palette.ts` → `semantic.ts` → screens, with the
  `SemanticColors` type forcing light and dark to stay structurally identical. This is
  exactly the structure a re-skin needs, which is why §4 can be as ambitious as it is.
- **"Unknown is valid"** — the product refuses to guess coverage. This is the honest
  thing and also, commercially, the differentiator. It survives V3 untouched.

### 1.2 Fifteen findings

Ordered by how much they cost the user, not by how hard they are to fix.

---

**F1 — There is no offline story.** `TanStack Query` is configured with no persister
(`apps/mobile/src/lib/queryClient.ts`). Close the app, lose the cache; open it in a
basement service centre with no signal and it is an empty shell.

This is not a nice-to-have for this product specifically. The moments when a person
needs MY Warranty are: standing in a shop arguing about coverage, sitting in a service
centre being asked for proof, on the phone to an importer. Those are exactly the places
with bad reception. **An offline-hostile warranty app fails at the only moments it
exists for.**

Fix: `@tanstack/query-async-storage-persister` over MMKV or AsyncStorage, an explicit
mutation outbox for writes made offline, and a visible "last synced" state — never a
silent stale read, because a stale expiry date is a wrong answer.

---

**F2 — Documents are the product and they are treated as an attachment.** Receipts and
warranty PDFs live in private Storage and are fetched on demand. There is no encrypted
on-device cache, and no way to hand a service centre everything at once.

Fix: a **Claim Pack** — one share-sheet action that produces a single PDF containing the
receipt, the warranty terms, the serial, the purchase date, the importer's details and
the resolution provenance. This is the highest-value small feature in this brief. It is
the difference between "an app that stores my receipt" and "an app that wins my
argument".

---

**F3 — The app abandons the user at the moment of value.** It tells you that you are
covered and what is covered, and then stops. There is no case, no timeline, no record
that you called, no note of what the importer promised. Warranty Case / Claim Timeline
has now been explicitly deferred in V2, Phase G, Phase H, Phase I and Phase I.5.

It is, on the evidence of the product's own shape, the largest missing feature. **§6
asks for that deferral to be lifted or confirmed**; the brief does not assume either.

---

**F4 — Adding a product costs too much.** The flow is four routes: `/add` →
`/add/scan` → `/add/review` → (`/add/manual`). Every warranty app in the category dies
of the same disease — manual entry — and the fix is not a better form, it is fewer
forms.

Target: **one capture, one confirm.** Point the camera at the receipt or the product
label; the resolution engine already built in Phase I.5 fills brand, model, purchase
date, retailer and importer; the user confirms or corrects one screen. `/add/manual`
becomes the escape hatch, not a peer route.

Instrument it: log taps-to-added-product as a metric and hold it. Nothing else in this
brief has a clearer number attached.

---

**F5 — Nothing arrives on its own.** Every product enters by a person deciding to open
the app and add it. That is the whole growth ceiling.

Three ingestion routes, none of which needs a crawler and none of which weakens the
rules in §6:
- **iOS/Android share target** — share a PDF receipt from Mail or Gmail straight into
  the app.
- **Photo-library scan, opt-in and on-device** — offer to look at photos that appear to
  be receipts. The offer must be explicit, per-run, and revocable.
- **A forwarding address** — `you+abc123@receipts.mywarranty.app`. Server-side parse,
  candidate status, user confirms. The forwarded mail is DATA, subject to §6's
  prompt-injection rule exactly like a PDF.

---

**F6 — The Protection Score has no memory.** It is computed well (8 factors) and shown
once. There is no history, no "71 → 92 since March", no sense of having improved
anything. A score that cannot go up in a way you can see is a grade, not a game.

Fix: persist a daily snapshot, show a sparkline over 90 days, and attribute movement to
the specific action that caused it. This is the cheapest retention feature available and
it uses data the app already computes.

---

**F7 — Hebrew typography is being rendered with Latin metrics.** A real bug, not a
preference. `apps/mobile/src/theme/tokens.ts` applies negative `letterSpacing` across
the scale — `display: -0.8`, `h1: -0.5`, `h2: -0.3`, `numeric: -0.6` — and `Text.tsx`
applies it unconditionally, for every language.

Negative tracking is a Latin display-type technique. Applied to Hebrew it crowds
letterforms that were never designed to be tightened, and it is actively wrong under
nikud. Hebrew also wants a slightly *looser* line height than Latin at the same size,
because it has no descenders to create optical space.

Fix: make the type scale locale-aware — one Latin metric set, one Hebrew metric set
(`letterSpacing: 0`, line height +1 to +2pt), selected in `Text.tsx` from the active
language. Given that Hebrew is a first-class language in this product rather than a
translation, this is not polish.

---

**F8 — Dynamic Type is capped in a way that fails accessibility sizes.** `Text.tsx`
sets `maxFontSizeMultiplier = 1.6`. Above that, text simply stops growing — a user on
an AX size gets a layout that refuses to honour their setting.

The cap exists because the layouts would break. That is the actual bug. Fix the
layouts — single-column reflow above ~1.3×, stacked rather than side-by-side metrics,
truncation only where the value is repeated elsewhere — and then raise the cap. An app
about paperwork will be used by people who enlarge text.

---

**F9 — Search barely exists.** Products are filterable but not searchable across
name, model, serial, retailer, importer and document text. Someone with forty products
navigates by scrolling.

Fix: one search field that reaches everything, backed by Postgres full-text search plus
the existing model-identity normalisation, so "מקבוק אייר" and `MBA M4` and
`MacBookAir` all find the same machine. The corpus work from Phase I.5 makes this nearly
free.

---

**F10 — Notifications only know about dates.** `warranty ends in N days` is one signal.
The valuable ones are unbuilt: the manufacturer registration window closing (often 14–30
days after purchase and worth real money), a recall affecting a product you own,
extended-warranty decision points, and "you have an open case with no reply for 9 days".

---

**F11 — No end-to-end tests and no visual regression.** 424 unit/integration tests
(140 domain + 51 console + 233 mobile) and 75 SQL assertions — but nothing that drives
the actual app through "add a product, see the coverage, open the claim pack". A
makeover that rewrites every surface without E2E coverage is how a working app becomes a
beautiful broken one.

Fix: Maestro flows for the six journeys that matter, run in CI. Snapshot the prototype
screens for visual diffing, since that is where the design is judged anyway.

---

**F12 — There is no performance budget.** No measured cold start, no bundle-size
ceiling, no frame-drop budget for the product list. §4 introduces real-time blur to the
navigation layer, which makes this urgent rather than tidy: the makeover must not be
allowed to make the app slower without anyone noticing.

Fix, before the first glass commit lands: record cold start to interactive, JS bundle
size, and list scroll frame rate on a mid-tier Android device and an older iPhone. Those
three numbers become the budget. Regressions fail CI.

---

**F13 — The admin console has no bulk-review ergonomics.** Phase I built five review
queues and they work, but a reviewer clears them one row at a time. At real corpus
volume the console becomes the bottleneck and the temptation to bypass review becomes
institutional — which is precisely what the publication guards exist to prevent.

Fix: keyboard-driven review (`j`/`k`/`a`/`r`), batch approve within one brand, and a
diff view for `needs_reverification`. Guards unchanged; only the speed of a legitimate
reviewer changes.

---

**F14 — The resolution rate is 58% against an 80% target, and the binding constraint is
known.** `docs/ISRAEL_CORPUS_PILOT.md` measured it: `no-contacts` costs the full
remainder, the model corpus is worth 25 points, clauses buy nothing. This is a data
problem with a measured answer, not a code problem.

It is listed here so the makeover does not get credit for it. **A prettier app with 58%
resolution is still 58%.** Corpus acquisition needs a real owner and it is not a design
task.

---

**F15 — Ambiguity is untested in the field and False Resolution Rate has zero
observations.** Also from the pilot docs: ambiguity measured 0% only because the
fixtures carry one model per brand, and FRR is computed over *reviewed* runs, of which
there are none. The safety property the whole architecture is built around —
*"false resolution is more dangerous than unresolved"* — is therefore **asserted but not
yet measured**.

No V3 feature should be described as safe on the strength of that number until reviewed
runs exist.

---

## 2. Features worth adding, ranked

Tier 1 is what makes someone keep the app. Tier 2 is what makes them pay. Tier 3 is what
makes them tell someone.

### Tier 1 — completes the core promise

1. **Claim Pack** (F2) — one share action, one PDF, everything a service centre asks
   for. Small, self-contained, immediately explicable in a store listing.
2. **Warranty Case timeline** (F3) — open a case, log every call and reply, attach
   photos, see how long they have had it. Gated on §6.Q1.
3. **One-capture add** (F4) — the funnel.
4. **Offline-first** (F1) — works where it is needed.
5. **Registration-window alerts** (F10) — the one notification with direct cash value.

### Tier 2 — worth money

6. **Protection Score history** (F6) — a reason to come back with nothing to do.
7. **Universal search** (F9).
8. **Household / shared workspace** — one home's appliances, both partners. The
   workspace model already supports ownership; this is surfacing, not schema.
9. **Recall monitoring** — high trust value, and strictly within the reviewed-corpus
   model: a recall is published global data, so it goes through
   candidate → reviewer → verified exactly like a policy. No crawler.
10. **Repair-or-replace guidance** — given age, price paid, coverage state and typical
    repair cost, help decide. Must say *unknown* when it does not know; an invented
    repair cost is the same class of error as an invented warranty.

### Tier 3 — differentiators

11. **Resale handoff** — transfer a product with its documents to another user. Turns a
    warranty into a transferable asset and makes the app viral at the moment of a sale.
12. **Insurance-grade home inventory export** — the whole portfolio with values, serials
    and photos, as one document, for a claim after a fire or a burglary.
13. **Importer response-time scoreboard** — aggregate, anonymised, measured from real
    case timelines. Only possible after Tier 1 #2, and genuinely nobody else has it.
14. **Apple Wallet pass per warranty** — the coverage end date on the lock screen.
15. **Live Activity during an open case** — "at service centre, day 4".

Explicitly **not** proposed: social feed, gamified streaks, AI chat as a primary
surface, price-tracking affiliate links. Each would fight the product's one credible
claim, which is that it does not make things up.

---

## 3. The flow

### 3.1 What is wrong with the current shape

Five tabs — Home, Products, Add (raised centre), Alerts, Profile — plus `/add` as four
routes. Two specific problems:

- **Add is a destination.** It is a raised centre button that opens a four-step modal.
  Capture should be a single gesture, not a place you go.
- **Alerts is a tab that is usually empty.** A tab earns its place by being worth
  visiting when nothing has happened. Alerts is not; it is a notification inbox wearing a
  tab's clothes.

### 3.2 Proposed shape

Four tabs, and capture promoted out of the tab bar entirely:

```
┌─────────────────────────────────────────────────────────┐
│  Home        Things       Coverage      Me              │
└─────────────────────────────────────────────────────────┘
                                              ⊕  ← floating capture
```

- **Home** — Protection Score with its 90-day trend, the one thing that is urgent, and
  suggested actions with their point values. Alerts fold in here as a bell in the header
  with a count; an inbox, not a tab.
- **Things** — the portfolio. Search-first, because F9. Grouped by room or category.
- **Coverage** — new, and the reason this is a four-tab app rather than a three-tab one.
  Everything cross-product: what is ending this quarter, what is unverified, open cases,
  documents. Today this information is scattered across six screens.
- **Me** — profile, plan, settings.
- **⊕ Capture** — a floating glass action pinned above the tab bar, present on Home and
  Things. Long-press for the three sources (camera / file / photo library). One tap =
  camera open, already scanning.

### 3.3 The one flow that matters, end to end

```
capture ──▶ resolve ──▶ confirm ──▶ covered
   │           │           │            │
   camera      six-stage   one screen   protection score moves,
   opens       matcher,    of already-  and you can see by how much
   scanning    on-device   filled       ▼
   already     where it    fields    ┌──────────────────────────┐
               can be                │ something breaks          │
                                     ├──────────────────────────┤
                                     │ open case ──▶ claim pack │
                                     │     │            │        │
                                     │     ▼            ▼        │
                                     │  timeline    one PDF,     │
                                     │  of every    share sheet  │
                                     │  contact                  │
                                     └──────────────────────────┘
```

Four taps from "I bought a thing" to "I am covered". Two from "it broke" to "here is
everything you need". Everything else in the app is in service of those two numbers.

**Ambiguity has a designed place in this flow.** When the matcher returns AMBIGUOUS it
must not pick the top candidate — it asks one question, with the distinguishers the
matcher already computes (`distinguishersFor` in `packages/domain/src/modelMatch.ts`):
"55-inch or 65-inch?" That is a better experience than a confident wrong answer *and*
it is the architecture's existing safety rule, surfaced rather than hidden.

---

## 4. The design language

### 4.1 The honest starting position

The V2 design is not bad. Warm sand-and-pine neutrals, a 6-level type scale, an 8pt
grid, protection state as a first-class colour role, `iris` reserved for AI-derived
content so the colour itself teaches provenance. That last idea is better than most
production apps manage.

What it is not, is *Apple-level*. Three specific reasons:

1. **Everything sits on one plane.** `Card` defaults to `elevation: 0` and V2
   deliberately removed borders. The result is correct, calm, and completely flat — a
   well-set document rather than an interface. Apple's hierarchy is built on depth.
2. **The motion is curves, not springs.** `tokens.ts` ships four durations and three
   cubic-béziers. iOS has not felt like cubic-béziers since about 2013. It feels like
   springs, and the difference is not subtle — it is most of what people mean by
   "native".
3. **Nothing is material.** Flat fills everywhere. No translucency, no vibrancy, no
   sense of layers above content. The navigation chrome is opaque `bg.surface` with a
   hairline, which is a 2017 tab bar.

### 4.2 Liquid Glass, as we will apply it

The rules below are the ones we commit to. Sourced as described in §0.1 and to be
confirmed against the HIG before implementation.

**The three-layer model is the whole thing:**

```
   ┌──────────────────────────────────────────┐
   │  overlay    vibrancy, fills ON glass     │  ← labels, symbols
   ├──────────────────────────────────────────┤
   │  navigation GLASS LIVES HERE, ONLY HERE  │  ← tab bar, header, capture
   ├──────────────────────────────────────────┤
   │  content    NEVER GLASS                  │  ← cards, lists, documents
   └──────────────────────────────────────────┘
```

Hard rules, all of which we adopt:

- **Glass is for the navigation layer only.** Never on content — not on cards, not on
  list rows, not on a document preview. A glass card is the single most common way apps
  got this wrong in 2025.
- **Never text directly on glass.** Text sits on a solid or on a vibrancy fill placed on
  the glass. This is the accessibility rule, not a taste rule.
- **No glass on glass.** Glass cannot sample glass. Multiple glass elements that belong
  together share one container, which provides one sampling region.
- **Tint carries meaning.** Tint is reserved for the primary call to action. A tinted
  everything says nothing.
- **Clear variant only over media.** `clear` requires all three: it sits over
  media-rich content, that content tolerates a dimming layer, and what is above the
  glass is bold and bright. Our screens rarely qualify — so `regular` is our default and
  `clear` is the exception, used over product photography.
- **Never override the accessibility settings.** Reduce Transparency, Increase Contrast
  and Reduce Motion are handled by the system on iOS 26 and must be handled by us in
  every fallback tier. We add no opacity slider of our own; iOS 26.1's own Clear/Tinted
  control is the user's, not ours.

The legibility criticism of Liquid Glass through the iOS 26 betas was real enough that
Apple shipped a Tinted mode in 26.1 to increase opacity and contrast. Our conclusion
from that is not "avoid glass" — it is **"glass on the navigation layer, generous
contrast, and a fallback that is honestly good rather than grudging"**.

### 4.3 The non-obvious problem, and the answer

Liquid Glass assumes there is something worth refracting underneath. It works on
Apple's surfaces because photos, maps and album art are sitting behind the chrome.

**Our content layer is flat warm sand.** Glass over `#FAF8F5` looks like a slightly
dirty rectangle. Adopting the material without changing the content layer would make
the app look *worse*, not better — and this is exactly the trap a Liquid Glass makeover
falls into.

So the content layer has to earn the material. Three changes, in priority order:

1. **Product photography becomes the content layer.** Every product already has an
   image or a generated `ProductIllustration`. On the product detail screen the image
   goes full-bleed to the top edge and the header glass floats over it. This is the one
   place `clear` is correct.
2. **Ambient colour derived from the product.** Extract a dominant colour from the
   product image and lay a very soft, very large radial wash behind the hero — 6–10%
   opacity, never a gradient card, never a colour that competes with protection state.
   Now the glass has something to bend. A Samsung TV's page is quietly blue-grey; a Dyson
   is quietly purple. The app stops looking like one template.
3. **The Protection ring becomes the ambient source on Home.** Home has no single
   product to draw from, so the score's own colour — pine when healthy, amber when
   something is ending — becomes a faint ambient field behind the hero. The glass tab bar
   then refracts the state of your coverage, which is the one piece of poetry this app
   is entitled to.

### 4.4 Token changes

Additive. `palette.ts` is unchanged; every colour below already exists.

**New: `material.*` in `semantic.ts`** — the thing the token system is currently missing
entirely.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `material.navFill` | `rgba(250,248,245,0.72)` | `rgba(22,19,15,0.72)` | tab bar, header — the solid-tier fallback value |
| `material.navBorder` | `rgba(28,25,23,0.08)` | `rgba(245,241,236,0.10)` | the hairline that makes glass read as an edge |
| `material.overlayFill` | `rgba(255,255,255,0.60)` | `rgba(255,255,255,0.10)` | the vibrancy fill text sits on, *on* glass |
| `material.ambientAlpha` | `0.08` | `0.14` | §4.3's derived wash |
| `material.separator` | `rgba(28,25,23,0.06)` | `rgba(245,241,236,0.08)` | on-glass dividers |

**Changed: `elevation` becomes two layered shadows, not one.** A single shadow reads as
a drop shadow; two — a tight contact shadow plus a wide soft one — read as an object
above a surface. Same `elevation(0..3)` signature, so no screen changes.

**Changed: motion becomes springs.** The `easing` cubic-béziers are retired for
interactive motion and kept only for opacity fades. Reanimated 4.5 is already a
dependency.

| Token | Spec | Use |
| --- | --- | --- |
| `spring.snappy` | `damping 28, stiffness 420, mass 0.9` | presses, toggles, segmented control |
| `spring.smooth` | `damping 26, stiffness 240, mass 1` | sheets, screen transitions |
| `spring.bouncy` | `damping 15, stiffness 200, mass 1` | glass morph, capture button |
| `spring.gentle` | `damping 30, stiffness 120, mass 1` | the score ring settling |

All four collapse to a 120ms fade under Reduce Motion. Not "animate less" — animate not
at all, because a half-honoured Reduce Motion is worse than none.

**New: the concentric-corner rule.** Apple's nesting rule, and it is the cheapest way to
stop looking amateur: an inner radius equals the outer radius minus the padding between
them. A 20pt card with 16pt padding holds a 4pt inner element, not another 20pt one.
This becomes a helper — `concentric(outer, gap)` — rather than a token, because it is
arithmetic.

**Changed: radii climb.** `xl: 20 → 22`, `xxl: 28 → 32`, and controls on glass go
`pill`. iOS 26 is rounder than iOS 17, and capsules are the default glass shape.

**New: the Hebrew metric set** (F7). Two parallel scales, chosen by locale in `Text.tsx`.
Hebrew gets `letterSpacing: 0` at every size and `lineHeight` +1 to +2pt.

### 4.5 Implementation: three tiers, one primitive

Screens must never know which tier they are on. One component, chosen at runtime:

```
<Surface material="nav" | "overlay" | "solid">
```

| Tier | Condition | Implementation |
| --- | --- | --- |
| 1 | iOS 26+, `isGlassEffectAPIAvailable()` true, Reduce Transparency off | `expo-glass-effect` `GlassView` — real `UIVisualEffectView` Liquid Glass |
| 2 | iOS 15–25, or iOS 26 where the API check fails | `expo-blur` `BlurView`, `intensity` tuned per tier, plus `material.navBorder` |
| 3 | Android, or Reduce Transparency on, or any failure | opaque `material.navFill` at full alpha + hairline |

Notes that matter:

- `expo-glass-effect` is **iOS 26+ only** and falls back to a plain `View` on
  everything else — so tier 3 has to be a real design, not a degradation. It must look
  deliberate on a mid-range Android phone. That is a design deliverable, not an
  afterthought.
- The runtime check is not optional: `isGlassEffectAPIAvailable()` exists because some
  iOS 26 builds shipped without the API and calling into it **crashes**.
- Verified prop surface, read from the package's own types:
  `glassEffectStyle` (`'clear' | 'regular' | 'none'`, or a config object with `style`,
  `animate`, `animationDuration`), `tintColor`, `isInteractive` (default `false`),
  `colorScheme` (`'auto'` — we pass our own theme explicitly, since the app has its own
  toggle and must not follow the system when the user has overridden it).
- Multiple glass elements in one region — the capture button beside the tab bar — go in
  one `GlassContainer` with a spacing value, which is what lets them morph into each
  other instead of overlapping as two separate panes.
- **Android is not a port.** It gets the same layout, the same springs, the same
  depth via layered shadows, and opaque surfaces. `expo-blur` on Android is a
  performance trap in a scrolling list and will not be used there.

### 4.6 What changes on screen

| Surface | Now | V3 |
| --- | --- | --- |
| Tab bar | opaque `bg.surface`, hairline, 84pt | floating glass capsule, inset 16pt, content scrolls behind |
| Header | none (`headerShown: false`) | glass, appears on scroll, large title collapsing to inline |
| Capture | raised 52×40 rounded rect in the tab bar | floating glass circle, `isInteractive`, tinted — the one tinted thing |
| Card | flat white, radius 20, no border | white, radius 22, two-layer shadow, concentric inner radii — **stays opaque** |
| Product detail | header + scroll | full-bleed image, glass header over it, ambient wash |
| Bottom sheet | `bg.elevated` | glass at the grabber, solid content below it |
| Protection ring | static SVG arc | springs to its value on appear, ambient field behind |
| Score | number | number + 90-day sparkline (F6) |
| Empty states | icon + text + button | same, with real weight in the illustration |

The row that matters most is `Card`. **Cards stay opaque.** That is the rule from §4.2
that will be hardest to hold when the glass looks good, and it is the one that keeps the
app legible.

### 4.7 Performance budget

Recorded before the first glass commit, enforced after:

| Metric | Device | Budget |
| --- | --- | --- |
| Cold start → interactive | iPhone 11, mid-tier Android | baseline + 10% |
| Product list scroll | both | ≥ 58 fps, no frame > 32ms |
| JS bundle | — | baseline + 8% |
| Glass surfaces on screen | — | ≤ 3, never inside a scrolling list |

The last row is the load-bearing one. Blur inside a `FlatList` row is the standard way
to make a beautiful app that stutters, and it is banned outright rather than
budgeted.

---

## 5. Phases

Each phase ships working software, is verified the way previous phases were — migrations
from zero, real assertions, measured numbers rather than estimates — and is committed
separately.

| Phase | Scope | Verified by |
| --- | --- | --- |
| **J — Foundation** | `material.*` tokens, `Surface` primitive with all three tiers, springs, layered elevation, `concentric()`, locale-aware type (F7), performance baseline (F12) | tier selection unit-tested per platform/setting; baseline numbers recorded |
| **K — Navigation** | glass tab bar, collapsing glass headers, floating capture, four-tab IA (§3.2), Coverage tab | every screen rendered in all 3 tiers × light/dark × en/he; screenshots |
| **L — Content layer** | full-bleed product imagery, ambient colour extraction, ring motion, score sparkline (F6), empty-state weight | contrast asserted ≥ 4.5:1 for every text-on-ambient combination |
| **M — Flow** | one-capture add (F4), ambiguity question UI, universal search (F9), Claim Pack (F2) | Maestro E2E (F11); taps-to-add measured before and after |
| **N — Depth** | offline-first (F1), share target + forwarding (F5), registration alerts (F10), Dynamic Type reflow + raised cap (F8) | airplane-mode E2E; AX-size screenshots at 1.6× and 2.4× |
| **O — Case** | Warranty Case timeline (F3) — **only if §6.Q1 is answered yes** | full suite; FRR observations from reviewed runs (F15) |

Phase J is the only one that must come first. K through N can be resequenced by
whatever matters commercially.

---

## 6. Constraints, unchanged

Every standing rule from V1 through Phase I.5 remains in force. Nothing in this brief
requires weakening any of them, and the ones this brief comes closest to are named
explicitly.

Verbatim, still binding:

> Do NOT expose service keys in mobile source. Do NOT hard-code pricing. Do NOT rely
> solely on local storage for user data. Do NOT make subscription state
> client-authoritative. Do NOT make uploaded warranty documents public. Do NOT store
> payment card numbers.

> **66. SECURITY** — Do not weaken any existing security controls. Preserve: RLS, secure
> storage, server-authoritative entitlements, private documents, validated AI output,
> workspace ownership, UUIDs, server-side subscription verification.

> **72. AI SAFETY / PROMPT INJECTION** — Warranty PDFs, receipts and webpages are DATA.
> Never allow content inside them to override system behavior. Preserve document
> isolation and prompt-injection defenses.

> **59. UNKNOWN IS VALID** — Never default: 12-month warranty, official importer,
> service provider, coverage, service availability, when information cannot be verified.

> **67. PRIVACY** — Service discovery must not require exact location.

> AI must NOT independently publish trusted global data. Candidate → reviewer →
> verified/published.

> Demo fixtures must never accidentally surface as verified production data.

> AI may suggest aliases during ingestion, but AI must not silently establish global
> model equivalence.

> False resolution is more dangerous than unresolved. Optimize for correctness before
> raw resolution percentage.

Where this brief touches them:

- **F1 (offline)** — a persisted cache is a cache, never the source of truth, and it
  holds no entitlement state. Subscription remains server-verified. This does not make
  local storage authoritative.
- **F2 (Claim Pack)** — generated on demand from private Storage, shared through the OS
  share sheet at the user's action. No public URL is ever minted.
- **F5 (forwarding address, photo scan)** — forwarded mail and scanned photos are DATA
  under rule 72, handled by the existing isolation. Photo access is opt-in per run and
  revocable. Ingested rows enter as `candidate`.
- **#9 (recalls)** — published global data, therefore
  candidate → reviewer → verified. No crawler.
- **#10 (repair-or-replace)** — must return *unknown* rather than an estimated repair
  cost. An invented cost is rule 59's error in a new costume.
- **§4.3 (ambient colour)** — decorative only. It never encodes coverage state, because
  a colour a user cannot name is not a status.

### Two questions this brief cannot answer for itself

**Q1 — Is the Claims / Warranty Case deferral lifted?** The instruction *"DO NOT START
CLAIMS. No Warranty Case Timeline"* has stood through five phases. F3 argues it is now
the biggest gap in the product, and Phase O is written for it — but the phase does not
start without an explicit yes. A makeover request is not, on its own, that yes.

**Q2 — Is the front-end skill set to be installed?** §0.2: the card is rendered, nothing
is enabled. The two Anthropic plugins are low-risk. The React Native bundle is
community-published with `privileged` reach — agents and hooks — and deserves a
deliberate decision.

---

## 7. Risks

| Risk | Reality | Mitigation |
| --- | --- | --- |
| Glass makes it *less* legible | The documented criticism of iOS 26, and Apple's own 26.1 climb-down | §4.2's hard rules; contrast asserted in CI, not reviewed by eye |
| Battery and heat | Third-party measurement of 13% vs 1%, unverified here | ≤ 3 glass surfaces, never in a list; §4.7 budget |
| Android looks like a consolation prize | Tier 3 is most of the install base | Tier 3 is designed first, not last, and reviewed on its own terms |
| Hebrew + glass + RTL | Three hard things at once, and Hebrew is a first-class language here | every Phase-K screenshot is taken in Hebrew as well as English, same review bar |
| The makeover buries F14 | 58% resolution does not improve because the app got beautiful | corpus acquisition tracked separately, with its own owner |
| Scope | Six phases is a lot of surface | Phase J first; everything after it is independently shippable |

---

## 8. The one-line version

The engine is good, the data is thin, the app is flat, and it lets go of the user at the
exact moment they need it — so: put the material on the navigation layer and give it
something worth refracting, cut adding a product to one capture, and stay with the user
through the claim.
