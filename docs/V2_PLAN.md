# V2 plan — visual direction, scoring model, UX architecture, phases

Companion to `docs/V2_AUDIT.md`. Read that first.

---

## 1. Visual direction

### The problem being solved

V1 reads as a competent dashboard. V2 has to read as something you'd trust with
proof of everything you own. Three changes carry most of that difference:

1. **Warmth.** Cool grey-blue neutrals read as software. Warm neutrals read as
   paper and objects — which is what this app is actually about.
2. **Product identity.** A list where every row shows the same grey square is a
   database view. A list where you recognise your TV before reading a word is a
   wallet.
3. **Fewer containers.** Not everything needs a card. Hierarchy should come from
   type, space and one strong surface — not from drawing a box around each idea.

### Light theme — warm, not clinical

Nothing here is pure white. The canvas is a warm off-white (`#FAF8F5`) so cards
in true white read as genuinely lifted without needing a shadow.

| Role | Value | Why |
| --- | --- | --- |
| canvas | `#FAF8F5` | Warm paper. Pure white is the clinical look the spec rejects |
| surface | `#FFFFFF` | Cards separate by being *brighter* than canvas, not by borders |
| surface subtle | `#F2EEE9` | Recessed fills — inputs, tracks, skeletons |
| surface elevated | `#FFFFFF` + soft warm shadow | Sheets and the one hero surface per screen |
| brand ink | `#231F1C` | Deep warm charcoal, not navy. Reads as ink |
| text primary | `#1C1917` | Warm near-black |
| text secondary | `#6B625B` | Warm grey |
| text tertiary | `#9C918A` | |
| border subtle | `#EAE3DB` | Warm hairline |
| brand accent | `#1F6F5C` | Deep pine green — protection, permanence, and *not* the SaaS blue |
| protection | `#0F7355` fg / `#DCF2E8` bg | Mint family |
| attention | `#A8620A` fg / `#FDF0DA` bg | Warm amber |
| danger | `#B0332B` fg / `#FBE3E0` bg | Coral-red |
| intelligence | `#5B4BB8` fg / `#EDE9FB` bg | Reserved *only* for derived/AI content, so the user learns what it means |

Green as the primary accent is the load-bearing choice. The subject is
protection and things staying whole; a deep pine green carries that where blue
carries "tech product". It also frees blue entirely, and lets the protection
state and the brand reinforce each other instead of competing.

### Dark theme — warm charcoal, not black

Designed independently, not inverted.

| Role | Value | Why |
| --- | --- | --- |
| canvas | `#16130F` | Warm charcoal. Not black, not navy |
| surface | `#211D19` | Differentiated by lightness, no border needed |
| surface subtle | `#2B2620` | |
| surface elevated | `#2F2923` | |
| text primary | `#F5F1EC` | Warm off-white — pure white glares at night |
| text secondary | `#B3A79C` | |
| border subtle | `#332D26` | |
| brand accent | `#4FBF97` | Green lifted for dark ground |
| protection | `#5FD0A6` | |
| attention | `#E8B45E` | |
| danger | `#F0918A` | |
| intelligence | `#A99BF0` | |

Contrast target: all body text ≥ 4.5:1 on its surface in both themes;
tertiary reserved for large or non-essential text.

### Product imagery

Every category gets a real illustration — a television reads as a television, a
laptop as a laptop. Drawn as inline SVG in one visual family (single-weight
stroke, same 24-unit grid, one warm accent fill), so they cohere the way an icon
set does while still being recognisable objects.

Resolution order: user photo → recognition image → category illustration. There
is no generic fallback below that, because "unknown object" is exactly the
experience being removed.

---

## 2. Protection Score — the formula

Deterministic and documented, per spec item 11. No model involvement.

### Per-product completeness

Eight weighted factors. Weights reflect what actually matters when you file a
claim.

| Factor | Weight | Satisfied when |
| --- | --- | --- |
| Purchase date | 20 | A valid calendar date is present |
| Warranty end known | 20 | An end date is set or derivable from duration |
| Proof of purchase | 18 | At least one receipt or invoice document attached |
| Warranty provider identified | 12 | `warranty_provider_id` set |
| Warranty terms available | 10 | Linked to a warranty policy with clauses |
| Serial number | 8 | Present |
| Service provider identified | 7 | `service_provider_id` set |
| Model | 5 | Present |
| **Total** | **100** | |

Completeness is the sum of satisfied weights. Anything unsatisfied appears as a
named, actionable gap — which is what feeds Home's *Recommended actions*.

Rationale for the weights: purchase date and warranty end decide *whether* you
have a claim; the receipt decides whether you can *prove* it; provider and terms
decide whether you can *act* on it. Serial and model matter but are recoverable
from the product itself.

### Portfolio score

The Home number is the **weighted mean of per-product completeness**, weighted by
each product's protection value:

```
score = Σ(completeness × w) / Σ(w)
w = 1.0  active or ending soon
    0.5  unknown warranty status
    0.25 expired
```

An expired product still counts — its records retain value for service
history — but it cannot drag the score down as hard as a live one. Products in
`sold` or `disposed` lifecycle are excluded entirely.

Empty portfolio returns `null`, not `0`. Zero would be a judgement about a user
who has done nothing wrong yet.

Bands: ≥ 85 strong · 60–84 fair · < 60 needs attention.

---

## 3. UX architecture

Navigation is unchanged — the five-tab structure works and the spec does not ask
for it to move. What changes is what each tab *does*.

```
(tabs)
  index      Home       Protection Score → attention → actions → products
  products   Products   image-led list, search, status filter
  add        Add        scan-primary, manual demoted
  activity   Activity   RENAMED from Alerts; permanent history, grouped by time
  profile    Profile    real account screen

product/[id]            hero image → status → timeline → quick actions
                        → Warranty Intelligence → What's covered → documents
product/[id]/service    Service Concierge          (V2.1)
product/[id]/checkup    Pre-expiry checkup         (V2.1)
coverage/[productId]    problem → analysis → verdict → next step
claim/[id]              Warranty Case + timeline   (V2.1)
settings/*              unchanged
```

`Alerts` → `Activity` is a rename plus a data-source change: it stops reading
`notifications` and starts reading `activity_events`.

---

## 4. Phases

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| **A** | Design token evolution — new palette, new semantic roles | — |
| **B** | Protection domain — score, completeness, gaps, tests | — |
| **C** | Product imagery — per-category illustration system | A |
| **D** | Vertical slice — Home, ProductCard, Product Detail, Add, Profile | A, B, C |
| **E** | V2 core migration — service capabilities, contacts, cases, activity, layers | — |
| **F** | Visual validation in the browser prototype, light/dark, en/he | D |
| **G** | Warranty Intelligence + What's covered UI | D, E |
| **H** | Service Concierge | E |
| **I** | Activity feed on `activity_events` | E |
| **J** | Warranty Case + claim flow | E, H |
| **K** | Pre-expiry checkups | E |
| **L** | Ask MY | E, G |

**A–F is V2 Core and is what this pass implements.** G–L follow once the design
language is validated rather than being built against a palette that may still
move.

---

## 5. What deliberately does not change

Per spec item 82. Supabase, Expo, Expo Router, the workspace model, RLS, the
organisation role enum, warranty policy versioning, provenance, the entitlement
system, the service layer, and all 92 existing tests.

The token *architecture* also does not change — only its values and the addition
of new semantic roles. Screens continue to consume `theme.colors.*` and never a
literal.
