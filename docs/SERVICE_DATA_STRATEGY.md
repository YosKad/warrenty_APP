# Service & warranty data strategy

MY Warranty is no longer limited by its code. It is limited by the fact that
`warranties`, `provider_contact_methods`, `service_capabilities` and
`service_locations` are, outside the demo fixtures, empty.

This document is about fixing that: what data is needed, where it comes from,
who verifies it, what it costs, and what an honest MVP corpus looks like. It is
deliberately concrete, because the vague version of this plan ("we'll scrape
manufacturer sites") is how the product ends up shipping confident wrong answers.

---

## 1. What the product actually needs

The app makes four claims to a user. Each one needs different data, and they fail
differently when the data is missing.

| Claim | Data required | Failure without it |
| --- | --- | --- |
| "Your warranty runs 24 months and ends on 31 August" | A policy row scoped to brand + model + country + importer, with a validity window | The countdown is the user's own guess, which they already had |
| "Here is what's covered and what isn't" | Clause-level `warranty_terms` with types, sections and verbatim text | The coverage check has nothing to reason over and correctly refuses to answer |
| "Samline honours it; XYZ Service repairs it" | `organisations` with roles, plus the importer link on the product or policy | The user goes back to Google, which is the thing we promised to replace |
| "Call this number, or a technician can come to you" | `provider_contact_methods` with purpose, and `service_capabilities` | Same, and worse: a wrong number is more damaging than no number |

The first two are Phase G. The last two are Phase H. **Only the third and fourth
are needed for the product to feel indispensable**, and they are also the
cheapest to acquire — a provider chain is a few dozen rows per brand, whereas a
clause corpus is a document pipeline per policy.

That ordering is the core recommendation of this document: **populate provider
and service data before warranty clause data.** A user who is told exactly who to
ring and that a technician can come to them will forgive not knowing clause 4.2.
The reverse is not true.

## 2. Source hierarchy

Already implemented in `src/domain/warrantyIntelligence.ts` and enforced by
tests. Restated here because it governs acquisition, not just display:

1. **Official importer / manufacturer documentation** — a PDF or a page on the
   company's own domain. The only tier that can be `verification = 'official'`.
2. **Verified internal record** — something a person on our side confirmed,
   typically by ringing the number. `verification = 'verified'`.
3. **Retailer documentation** — a chain's own warranty leaflet. Real, but narrower.
4. **User-uploaded document** — the user's own warranty booklet, scoped to them
   unless promoted.
5. **User-entered information** — what someone typed. Never global.
6. **AI / web extraction** — candidate only. `verification = 'ai_extracted'`, and
   **never published globally without a human step**.

The rule that matters operationally: *tier 6 can populate the database, but tier
6 alone can never reach a user as fact.* An extracted phone number sits as a
candidate until someone confirms it, and the app renders unverified data with its
freshness state visible.

## 3. Israel-first ingestion

Israel is the right first market for a reason that is also a data advantage: the
importer layer is unavoidable there. A Samsung television in Israel is warranted
by a local importer, not by Samsung, and no global dataset knows that. That is
exactly the gap the product fills — and it means a modest, hand-built Israeli
corpus is worth more than a large scraped international one.

**Phase 1 — the top of the long tail (target: ~40 organisations).**

The Israeli consumer-electronics market concentrates hard. A small number of
importers cover most of what people own:

- Television & audio: the official importers for Samsung, LG, Sony, Hisense, TCL
- White goods: the importers for Bosch/Siemens, Electrolux, Whirlpool, Beko, Haier
- Computing & phones: Apple's local network, Samsung mobile, Xiaomi, Lenovo, HP, Dell
- Small appliances: Dyson, Philips, Braun/Oral-B, Delonghi
- Retail chains that carry their own extended warranties

For each: legal name, roles, website, warranty-claims contact, service network,
and — where published — home-visit and pickup capability.

**Phase 2 — service locations (target: ~200 branches).** These are published on
importer websites as branch lists, and they change slowly. This is the single
highest-value dataset in the product: nobody else assembles "authorised branches
that service *this* category".

**Phase 3 — warranty policies (target: ~150 policies).** One per brand ×
category × importer, with duration and the summary fields. Clause-level extraction
comes after, and only for the brands that generate the most coverage checks.

## 4. Verification

Three states, three costs:

| State | How it is reached | Cost |
| --- | --- | --- |
| `ai_extracted` | Automated extraction from a fetched page or PDF | Minutes of compute |
| `community_submitted` | A user report accepted, or a low-friction internal entry | Minutes of a person's time |
| `verified` | Somebody confirmed it against the source, or rang the number | ~5 minutes per contact |
| `official` | Taken from a document on the company's own domain, with the URL and retrieval date stored | ~10 minutes per policy |

**A contact method is worth verifying by telephone. A policy duration is worth
verifying against a document.** Ringing 40 importers to confirm their warranty
line is roughly four hours of work and is the highest-leverage four hours
available to this product.

## 5. Freshness and refresh

Implemented as `freshness()` in `src/domain/serviceConcierge.ts`: 90 days
"recent", 270 days "verified", 540 days "worth double-checking", beyond that "may
be out of date". The UI shows the state rather than hiding the age.

The refresh loop:

1. **Content hashing.** `warranty_sources.content_hash` already exists. A
   scheduled fetch that finds a changed hash flags the policy for re-extraction
   rather than silently replacing it — and old products keep their old policy,
   which is what `valid_from`/`valid_to` is for.
2. **User signals.** `service_data_reports` is the cheapest sensor available:
   the user is standing in front of a closed branch. Two independent reports on
   the same record should raise its review priority automatically.
3. **Age-triggered re-verification.** Anything past 540 days enters a queue.
   With a corpus of 40 organisations this is a couple of hours per quarter.

## 6. What can be automated

- Fetching a known URL and detecting that it changed (hash comparison).
- Extracting clause candidates from a warranty PDF — `warranty-extract` does
  this today, marking everything `ai_extracted`.
- Extracting branch lists from structured pages (tables, JSON-LD, store locators).
- Normalising phone numbers, matching an organisation name to an existing row,
  geocoding an address.
- Detecting *conflicts* between a new extraction and an existing verified record,
  and queueing them instead of overwriting.

## 7. What must not be automated

- **Publishing a phone number as verified.** The failure is silent and the cost
  lands on the user.
- **Asserting an importer relationship.** "Who warrants this in Israel" is
  precisely what a model will confabulate plausibly.
- **Closing a service location.** A false closure removes the only correct answer.
- **Overwriting a `verified` or `official` record with an extraction.** The
  source hierarchy exists to make this structurally impossible.
- **Uncontrolled crawling.** Adapters per known source, with a stored source URL
  and retrieval date. A general crawler produces data nobody can defend and legal
  exposure nobody wants.

## 8. Proposed MVP corpus

| Dataset | Target | Effort | Priority |
| --- | --- | --- | --- |
| Organisations with roles | 40 | ~6 h | **1** |
| Warranty-claims contact per importer, phone-verified | 40 | ~4 h | **1** |
| Service capabilities (home visit, pickup, drop-off) | 40 | ~3 h | **2** |
| Service locations | ~200 | ~12 h | **2** |
| Warranty policies (duration, provider, source) | ~150 | ~15 h | **3** |
| Clause-level terms | ~30 policies | ~10 h + extraction | **4** |

**Roughly 50 hours of structured work** produces a corpus that covers the
majority of what an Israeli household owns. That is the whole bottleneck. It is
not a technology problem and should not be waiting on one.

## 9. First brands to populate

Ordered by (units in Israeli homes) × (likelihood of needing service) ×
(difficulty of finding the answer today):

1. **Samsung** — televisions and white goods. Importer ≠ manufacturer, which is
   the case the product exists for.
2. **LG** — same shape, same confusion.
3. **Bosch / Siemens** — long warranties, expensive repairs, opaque service.
4. **Apple** — high value, but the easiest for a user to find alone. Include for
   completeness rather than for need.
5. **Electrolux, Beko, Haier, Hisense, TCL** — the volume tier.
6. **Dyson, Philips, Delonghi** — small appliances, frequent faults.

## 10. Cost and operational complexity

- **People, not infrastructure.** The database, RLS, RPCs and extraction pipeline
  are built. What is missing is somebody making calls and reading booklets.
- **Admin tooling is the first real gap.** `service_data_reports` has a queue and
  no reviewer. Until there is a simple internal screen — accept, reject, edit,
  verify — every correction is a manual SQL statement. This is a few days of
  work and it gates everything in §5.
- **Extraction spend is negligible** compared with verification labour. A
  warranty PDF is a few thousand tokens; a phone call is five minutes.
- **The legal position is the reason for adapters, not just cleanliness.**
  Storing a source URL, a retrieval date and verbatim clause text with attribution
  is defensible. A general crawler republishing warranty terms without provenance
  is not.

## 11. Recommendation

1. Build the admin review screen for `service_data_reports` and organisation
   editing. Nothing else in this document is repeatable without it.
2. Populate the 40 organisations and their warranty-claims contacts by hand.
   Verify the phone numbers by ringing them.
3. Populate service locations from importer branch lists with a per-source
   adapter.
4. Only then move to policies and clause extraction.

The app already refuses to invent an answer. That refusal is the right behaviour
and it is also, right now, the most common one — which makes closing this gap the
single highest-value work available.
