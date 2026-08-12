# Design system

## Direction

MY Warranty should read as a premium consumer utility — closer to Apple Wallet
and Things than to a SaaS dashboard. The governing instinct is **restraint**:
most screens answer one question, and everything that does not serve that
question is removed rather than shrunk.

What we are not doing: gradient washes, glassmorphism, oversized cards, icon
grids, or a colour for every state. The app handles someone's receipts and their
money; it should feel calm and trustworthy, not playful.

## Tokens

Three layers, and screens only ever touch the third.

**Primitives** (`src/theme/palette.ts`) — raw values with no meaning. Nothing
imports this except `semantic.ts`.

**Semantic** (`src/theme/semantic.ts`) — colours named for their role:
`colors.text.primary`, `colors.status.endingFg`, `colors.control.primaryBg`. The
light and dark maps are structurally identical, enforced by the `SemanticColors`
type — a token added to one theme fails to compile until it exists in both.

**Non-colour** (`src/theme/tokens.ts`) — spacing, radii, typography, motion,
elevation.

The point of the indirection: the entire product can be re-skinned, and later
re-branded under a different name, without touching a single screen.

### Palette

Deep navy (`#0B1220`) as the resting brand surface. Electric blue (`#1F6FEB`) as
the accent, used sparingly — roughly one accent element per screen, on the single
most important action. Refined cyan as a secondary accent for timelines and
illustration.

Status colours: green active, amber ending soon, red expired, grey unknown.

**Colour is never the only signal.** `StatusBadge` pairs each state with a
written label *and* a distinct dot shape: filled circle (active), ring (ending
soon), hollow square (expired), dash (unknown). The badge stays legible with
colour-vision deficiency, in greyscale, and to a screen reader. That is a WCAG
requirement and also just better design — "green" means nothing to someone who
has not learned the code.

### Spacing

Strict 8pt scale with two half-steps for dense controls:

```
xxs 2   xs 4   sm 8   md 12   lg 16   xl 24   xxl 32   xxxl 48   huge 64
```

A value outside this scale is a design bug, not a code one.

### Typography

Platform system fonts — SF Pro on iOS, Roboto on Android — so text renders the
way each OS expects while the scale stays identical.

| Variant | Size / line | Use |
| --- | --- | --- |
| `display` | 34 / 40 | Onboarding, one per screen at most |
| `h1` | 28 / 34 | Screen title |
| `h2` | 22 / 28 | Warranty card, section lead |
| `h3` | 17 / 22 | Card title, list section |
| `body` | 16 / 22 | Default |
| `bodyStrong` | 16 / 22 | Product names |
| `bodySmall` | 14 / 20 | Secondary |
| `caption` | 13 / 18 | Metadata |
| `metadata` | 11 / 14, uppercase, +0.6 tracking | Section labels |
| `numeric` | 28 / 32 | Counts and day counters |

Letter spacing tightens as size grows. That is what makes large text read as
designed rather than as scaled-up body copy.

Dynamic Type is on by default, capped at 1.6× — large enough to be genuinely
accessible, bounded enough that layouts stretch rather than break.

### Elevation

Cross-platform, since Android ignores shadow offsets. `theme.elevation(level)`
returns a matched iOS shadow and Android `elevation`.

Used sparingly. `Card` defaults to `flat` (a hairline border) because a list of
eight shadowed cards reads as noise. Shadow is reserved for surfaces that
genuinely float: bottom sheets, toasts, the selected segment.

## Components

`src/ui/`. Every one is theme-aware, RTL-aware and accessible by construction.

| Component | Notes |
| --- | --- |
| `Text` | The only text primitive. Variant + semantic tone; screens never set fontSize or color. |
| `Button` | primary / secondary / ghost / danger. Exactly one primary per screen — if a screen seems to need two, it has two primary tasks and should be split. |
| `Card` | flat / raised / brand / subtle. Pressable variant scales to 0.985 rather than dimming. |
| `Screen` | Safe areas, keyboard avoidance, canvas colour. Bottom inset goes on the scroll content so content scrolls under the home indicator. |
| `Input` / `PickerField` | Label above the field, never floating — a floating label disappears exactly when someone reviewing OCR data most needs it. |
| `ListRow` / `ListGroup` | Navigation, toggle and value rows in one component, with inset separators. |
| `StatusBadge` | Colour + label + shape. |
| `SegmentedControl` | Mutually exclusive filters with counts. |
| `SearchField` | `textAlign: auto`, so a Hebrew query aligns right and an English one left in the same field. |
| `BottomSheet` | Built on the platform Modal. ~120 lines is cheaper to own than a dependency that must track every RN release. |
| `Toast` | Confirmation of something that happened. Announced to screen readers. Never a question. |
| `Skeleton` | Shows the shape of what is coming. Pulse disabled under Reduce Motion. |
| `EmptyState` | Every list has one. |
| `ProvenanceNote` | The trust layer, made visible. |
| `WarrantyTimeline` | Purchase → today → expiry as one track. |
| `ProductCard` | Four facts: name, brand, status, time remaining. |

### The provenance note

`ProvenanceNote` deserves its own paragraph because it encodes the product
philosophy rather than a visual style.

Wherever the app shows information it worked out rather than information the user
typed, this component says where it came from and how confident we are:
"Manufacturer warranty terms · Confirmed", "Estimated — please verify". It is
small and quiet by design. The point is that it is always there.

`VerifyPrompt` is its stronger sibling, used when a value is low-confidence
enough that the user really should confirm before relying on it.

### The product card

Four facts and no more: name, brand, status, time remaining. Model numbers,
serials, prices and categories all belong on the detail screen. Putting them on
the card turns a scannable list into a table.

The time-remaining line adapts: "312 days remaining" while there is time to act,
an explicit date once the number is large enough to be meaningless, and "expired
12 days ago" afterwards.

## Motion

| Token | Duration | Use |
| --- | --- | --- |
| `instant` | 90ms | Press feedback |
| `fast` | 160ms | Toasts |
| `normal` | 240ms | Sheets, transitions |
| `slow` | 380ms | Skeleton pulse |

Short and purposeful. No confetti, no celebration animations, no bounce. The app
is a tool someone reaches for when their washing machine is broken.

Reduce Motion is respected: `Skeleton` and `BottomSheet` both check
`AccessibilityInfo.isReduceMotionEnabled()` and fall back to static presentation.
A looping animation is genuinely uncomfortable for some people.

## Accessibility

- 48pt minimum touch target (Apple asks 44, Material 48; we standardise on the
  stricter one).
- Semantic roles and labels on every interactive element.
- Errors announced via `accessibilityLiveRegion` and rendered as text, never as a
  red border alone.
- Bottom sheets set `accessibilityViewIsModal` so VoiceOver does not wander into
  the screen behind.
- Decorative elements (the pager dots, the timeline track, skeletons) are hidden
  from assistive tech; their information is always available as text elsewhere.
- Dynamic Type to 1.6×.
- All body text meets WCAG AA (4.5:1) on its surface in both themes;
  `text.tertiary` is reserved for large or non-essential text.

## RTL

Hebrew ships at launch, and RTL is designed rather than blindly mirrored.

**Mirrored:** layout direction, chevrons, back arrows, list insets, sheet
alignment.

**Not mirrored:** the camera icon, the document icon, the warranty mark. A
mirrored camera icon just looks broken. `icons.tsx` applies `scaleX: -1` only to
genuinely directional glyphs.

**Pinned LTR:** serial numbers, model codes, phone numbers and reference numbers.
`isolateLtr` in `lib/format.ts` wraps them in Unicode bidi isolates. Without
this, digits visually reorder in an RTL paragraph and the user reads a different
number than the one printed on the appliance — which, when they are reading a
serial number to a service technician, matters.

**Input alignment:** `textAlign: 'auto'` on text fields, so a Hebrew product name
and an English model number each align correctly in the same form.

Switching between an LTR and an RTL language needs a native restart.
`applyDirection` reports that so the language screen can tell the user, rather
than leaving a half-mirrored layout.

## Dates, numbers and currency

All formatting goes through `Intl` in `lib/format.ts`. A US user sees
05/20/2026; an Israeli user sees 20/05/2026; neither required a conditional in a
screen. Currency renders from the stored amount plus its ISO code, so 4999.00 ILS
shows as ₪4,999.00 and never as $4,999.00.

Warranty dates are formatted in UTC to preserve the calendar day.
