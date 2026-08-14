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
