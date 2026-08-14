# Phase H — Service Concierge

Audit written before the schema was touched, per the phase brief.

Phase G answered "what does my warranty say". Phase H answers the question that
immediately follows it and that no consumer app currently answers well: *so who
do I actually call, and what will they do?*

The gap is not conceptual. Phase E already built `service_capabilities`,
`provider_contact_methods` and reused `service_locations`, and Phase G resolves
the provider chain. What is missing is the layer that turns three tables into one
recommendation, and — more seriously — the data to put in them.

---

## A. Audit

| Concern | State | Notes |
| --- | --- | --- |
| `organisations` with role array | **EXISTS** | Five roles, distinct entities, already correct |
| `service_locations` | **PARTIAL** | Has address, coordinates, phone, opening hours. No brand/category scoping, no appointment flag, no provenance |
| `service_capabilities` | **PARTIAL** | Table and three-valued availability exist. The enum has six kinds; the brief names twelve |
| `provider_contact_methods` | **PARTIAL** | Kinds, hours, languages, priority, provenance all present. No *purpose* — so "customer service" and "warranty claims" are indistinguishable |
| Provider chain resolution | **EXISTS** | `buildProviderChain()` from Phase G, five roles, never collapsed |
| `product_warranty_matches` | **EXISTS** | The resolved policy is what decides the service route |
| Distance ranking | **PARTIAL** | `rankByProximity()` exists but ranks *before* filtering for compatibility |
| Opening hours display | **MISSING** | Stored as JSONB, never rendered |
| Contact-method purpose ranking | **MISSING** | The recommendation engine |
| Capability-aware recommendation | **MISSING** | "Book a technician" vs "Visit a service centre" |
| Tap-to-action (dial, WhatsApp, mail, maps) | **MISSING** | |
| Map provider choice | **MISSING** | |
| Service readiness | **PARTIAL** | Protection completeness is close, but readiness is about *this* service visit |
| Pre-filled service request | **MISSING** | |
| User corrections for service data | **MISSING** | New table |
| Freshness / staleness of contacts | **PARTIAL** | `verified_at` exists; nothing derives a state from it |
| Location privacy | **EXISTS** | Nothing in the app requests GPS today, and profile country/region already exist |
| Activity event hooks | **EXISTS** | `activity_events` from Phase E; no writer yet |
| **Real provider data** | **BLOCKED BY DATA** | The tables are empty outside fixtures. This is now the binding constraint on the whole product — see `docs/SERVICE_DATA_STRATEGY.md` |

## B. Reuse decisions

| Proposed | Decision |
| --- | --- |
| `service_centers` | **Reuse `service_locations`**, extended with brand/category scoping and provenance |
| `service_route` table | **Derived, not stored.** It is a function of the resolved warranty plus the provider chain, both already persisted. Storing it would need invalidating whenever either changes |
| `contact_purposes` lookup | **A column on `provider_contact_methods`**, not a table. It is a closed vocabulary |
| `service_readiness` table | **Computed.** Same argument as protection completeness in Phase E |
| `service_data_reports` | **New.** A user saying "this number is dead" must never write to a globally shared record; it needs its own queue |
| Map provider config | **Client-side.** Which map apps exist is a device fact, not a database one |

Net: 1 table added, 3 extended, 4 avoided by reuse.

## C. What deliberately does not change

The warranty intelligence architecture from Phase G is untouched.
`getApplicableWarranty()` keeps its shape, and the service route consumes its
output rather than re-deriving the chain.

Claim tracking is explicitly out of scope. Phase H ends at *request prepared*;
the timeline, provider replies and repair status belong to Phase I.


---

## D. What shipped

| Requirement | Where |
| --- | --- |
| 3 Provider chain UX | `collapseChain()`, `ServiceRouteCard` — one company, all its roles |
| 4 Get Service screen | `app/service/[productId].tsx` |
| 5 Recommendation engine | `recommendRoute()` — deterministic, ordered by user effort |
| 6 Contact purposes | `contact_purpose` enum, `PURPOSE_RANK` |
| 7 Tap-to-action | `ContactActions`, `urlFor()` — no dead buttons |
| 8 Capabilities | Nine new enum values, `capabilityState()` with synonyms |
| 9 Human-friendly options | `ServiceOptions` — three states, "not confirmed" is one of them |
| 10–12 Locations, nearest, matching | `find_service_locations()` filters, `rankLocations()` ranks |
| 13 Map actions | `mapUrl()` for Apple, Google and Waze |
| 14 Opening hours | `openingStatus()` in the branch's own timezone |
| 15–16 Preparation and readiness | `serviceReadiness()`, `ServiceReadinessCard` |
| 18–20 Prepared request | `buildServiceRequest()`, editable, copied not sent |
| 21 Service forms | `web_form` outranks `website` in `KIND_RANK` |
| 22–24 Provenance and freshness | `source`, `verification`, `verified_at` on every record; `freshness()` |
| 25 Corrections | `service_data_reports`, `ReportDataSheet` |
| 27 Israel-first | Hebrew names, Israeli dialling in `toDialable()`, bidi isolates |
| 28 Product-specific routing | The resolved policy drives `get_service_route()` |
| 29 Unknown route | `UnknownRoute` — no generic support number |
| 35–36 Integration | `ServicePreview` on Product Detail, coverage result carries context |
| 39 Activity hooks | `record-activity` Edge Function |
| 40 Analytics | Ten events, none carrying a number, address or issue text |
| 41–42 Tests | 56 domain tests, 15 SQL assertions, a dedicated privacy file |
| 47 Data strategy | `docs/SERVICE_DATA_STRATEGY.md` |

## E. Known limitations

- **The tables are empty outside fixtures.** This is the binding constraint on
  the product and the subject of `SERVICE_DATA_STRATEGY.md`.
- **No admin review screen.** `service_data_reports` has a queue and no
  reviewer, so every correction is currently a manual SQL statement.
- **`record-activity` maps several service interactions onto `case_updated`.**
  The `activity_event_kind` enum has no service-specific values yet; the precise
  action is carried in the payload. Phase I should decide whether to widen it.
- **Distance ranking is straight-line.** Adequate for "which branch is nearest",
  and it means the app never needs a routing API or precise GPS.
- **Opening hours do not model holidays.** An Israeli service network closed for
  a festival will still read as open.
