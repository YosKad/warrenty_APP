# Israel corpus pilot

Three brands — Samsung, Apple, Dyson — run end to end through the data
operations console, to find out what a complete chain costs and what it buys.

---

## 0. What this pilot could and could not measure

This has to come first, because the phase brief asked for measured numbers and
said not to reuse a previous estimate as fact. Reporting a number nobody
produced would be a worse failure than reporting a gap.

**The environment this pilot ran in has no general outbound web access.**
Requests to `samsung.com`, `gov.il` and everything comparable are refused at the
proxy (`CONNECT tunnel failed, response 403`). So the half of the work that
consists of *finding out what is true* — reading an importer's warranty booklet,
confirming which company holds the Samsung agreement in Israel, checking that a
service number still answers — could not be performed, and no time for it is
reported here.

What *was* measured, on real code against a real PostgreSQL database:

| Measured | Not measured |
| --- | --- |
| How many records a complete chain needs, per brand | How long a person takes to find those facts |
| Full Resolution Rate across a 12-case suite | Whether real receipts resolve at the same rate |
| Which layer of the corpus each point of that rate depends on | Whether the researched values would be correct |
| Machine time to read and validate a 500-row import | The cost of producing that spreadsheet |

Every corpus record used below is a **pilot fixture**: documentation-range phone
numbers, `example.invalid` URLs, `data_environment = 'demo'`, and
`'PILOT FIXTURE — chain shape only, not researched'` written into the row. They
are the right *shape* and none of the values are claims about the real world.
`supabase/pilot/israel_pilot.sql` says the same thing at the top of the file.

---

## 1. What a complete chain costs, in records

Measured by building one for each brand:

| Brand | Policies | Clauses | Relationships | Contacts | Branches | Capabilities | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Samsung | 2 | 12 | 3 | 7 | 3 | 5 | **32** |
| Apple | 1 | 5 | 3 | 2 | 1 | 4 | **16** |
| Dyson | 1 | 4 | 2 | 1 | 0 | 2 | **10** |

Plus 6 organisations shared between them, for **65 records across three brands** —
a mean of 22, with a range from 10 to 32.

The spread is the finding, not the mean. It tracks how complicated the brand's
Israeli arrangement is, not how big the brand is:

- **Samsung** is the expensive shape. Three separate companies — the
  manufacturer, an importer who also honours the warranty, and a third company
  that does the repairs — so every relationship has to be stated and the
  contacts split across two organisations.
- **Apple** is one company in four roles at once. Fewer records, and the case
  where a resolver that collapses the provider chain looks correct by luck.
- **Dyson** is the cheap and unsatisfying shape: a global policy with no Israeli
  scope, which resolves but tells an Israeli owner very little.

A 40-brand corpus at this mean is roughly 900 records. That is a statement about
*rows*, not about hours.

## 2. What the corpus buys: Full Resolution Rate

Twelve cases, run through `probe_resolution` and scored by `evaluateResolution` —
the same function the app reasons with, so the number measures the resolver
rather than a friendlier copy of it. Reproduce with `npm run pilot -- --ablate`.

```
  variant            product  warranty  provider  route   FULL
  full                  75%      58%      58%     58%    50%
  no-contacts           75%      58%      58%     58%     0%
  no-relationships      75%      58%      58%     50%    50%
  no-clauses            75%      58%      58%     58%    50%
  policies-only         75%      58%      58%      0%     0%
```

**Contacts are the whole product.** Withhold them and the Full Resolution Rate
goes from 50% to zero while every other stage is unaffected — the corpus still
identifies the product, resolves the policy and names the company, and the user
still cannot do anything. This is the single most useful number the pilot
produced, and it inverts the intuitive order of work: policies feel like the
valuable data and are worth nothing on their own.

**Clauses buy no resolution at all.** Removing every clause changes nothing in
this table, because clauses answer "what is covered" and the rate measures "can
you get it fixed". They are not wasted work — they are the Phase G product — but
they should not be sequenced ahead of contacts.

**Relationships are worth less than expected here (58% → 50% on route
resolution) only because the fixtures also carry Phase H's `serviced_brand_ids`
on the branches**, which the resolver falls back to. In a corpus built purely
from relationships, removing them would take the route stage to zero.

### Where the 50% goes

```
    5  policy_missing          no policy, or none strong enough to state
    4  contact_missing
    3  model_unknown
    2  provider_unknown
    1  product_unknown
    1  insufficient_receipt_data
    1  importer_unknown
    1  stale_data
```

Case by case (`#` = stage passed):

```
  #####  Samsung OLED, official importer         fully resolved
  #####  Samsung OLED, importer not on receipt   fully resolved
  .....  Samsung model we have no terms for      model_unknown, policy_missing
  #####  MacBook, one company in four roles      fully resolved
  #####  MacBook, no importer named              fully resolved
  ####.  Dyson vacuum, global terms only         stale_data
  #....  Dyson bought before our terms start     policy_missing, provider_unknown, …
  #####  Receipt with no purchase date           insufficient_receipt_data
  .....  Brand we have never heard of            product_unknown, model_unknown, …
  #....  Samsung bought abroad, brought to Israel policy_missing, contact_missing
  .....  Apple, model written as on the box      model_unknown, policy_missing, …
  #####  Samsung with the importer's legal name  fully resolved
```

Four of these are the corpus working correctly by refusing:

- *Dyson bought before our terms start* — the policy is in force from 2022 and
  the purchase is 2019. Returning the current terms would be the confident wrong
  answer the whole product exists to avoid.
- *Samsung bought abroad* — the Israeli importer's terms are correctly not
  applied to a German purchase, and the global policy is too weak to state.
- *Brand we have never heard of* — no invention.
- *Receipt with no purchase date* — the policy resolves, but the app cannot say
  whether cover is still running, and says so.

Two are genuine corpus weaknesses a real pilot would fix:

- *Apple, model written as on the box* — "MacBook Air M4" does not match the
  `M4%` pattern. Model normalisation is doing less work than it should.
- *Samsung model we have no terms for* — a real gap, and the correct behaviour
  is the one it produced.

**This is a synthetic suite, and a synthetic suite measures the corpus, not the
product.** It says whether the data can answer questions somebody wrote down. It
says nothing about whether a photographed receipt with a smudged model number
would be identified at the same rate. Every run is stored with
`detail.synthetic = true` and the console labels it on every row, so the figure
cannot quietly become an accuracy claim later.

## 3. The mechanical half, measured

`npm run bench:import`, 500 rows with Hebrew headers, through exactly the code
the console runs:

```
  CSV      500 rows  read     4 ms  validate    3 ms  duplicates   511 ms
  XLSX     500 rows  read    66 ms  validate    2 ms  duplicates   506 ms
  (7 of 7 columns mapped automatically from the Hebrew headers)
```

Reading and validating 500 branches costs under a tenth of a second. Duplicate
detection costs half a second against 200 existing records and is quadratic, so
at 5,000 existing records the same file would take roughly a minute — still not
the bottleneck, but the part to watch.

The mapping number matters more than the timings: all seven Hebrew columns were
recognised without an operator touching them. The mechanical cost of a bulk
import is not the machine time, it is the mapping and the error triage, and the
alias table removes most of the first.

## 4. So what does a brand cost?

The honest answer has two halves and only one of them has a number.

**Machine and data-entry half — measured.** 10–32 records per brand. Through
bulk import, the machine cost is negligible. Through the console's forms, it is
one page per organisation plus one row each for contacts, branches and
capabilities; the record count above is the number of forms.

**Research half — not measured, and not estimated here.** Finding which company
holds the importer agreement, obtaining the warranty booklet, confirming the
service network and checking that a number answers cannot be done from this
environment. Any figure produced here would be a guess wearing a measurement's
clothes.

What the pilot *does* say about the research half is where to spend it. Given
that withholding contacts takes the rate to zero and withholding clauses changes
nothing, the sequence for a real pilot is:

1. The importer relationship, per brand and country.
2. One actionable contact for the company that honours the warranty.
3. The service route — who repairs it, and one way to reach them.
4. The policy terms.
5. The clauses.

That order is derived from the ablation table above, not from intuition. It is
close to the reverse of the order the data feels valuable in.

## 5. Reproducing this

```bash
createdb mw
psql -d mw -c 'create extension pgcrypto; create extension citext;'
psql -d mw -f supabase/tests/local_shim.sql
for f in supabase/migrations/*.sql; do psql -d mw -v ON_ERROR_STOP=1 -f "$f"; done
psql -d mw -f supabase/seed.sql
psql -d mw -f supabase/seed_demo_warranty.sql
psql -d mw -f supabase/seed_demo_service.sql
psql -d mw -f supabase/pilot/israel_pilot.sql

npm run pilot -- --ablate
npm run bench:import
```

Two migrations need Supabase Storage, `pg_cron` and `pg_net` and are skipped
locally: `20260101000800_storage_and_rpc.sql` and
`20260101000900_scheduling_and_usage.sql`.

## 6. What a real pilot needs that this one could not have

- **Web access**, or an operator with it. Everything in section 4's research
  half depends on it.
- **A real test set.** Twelve receipts photographed by twelve people, entered as
  a suite marked `synthetic: false`. Until that exists, the Full Resolution Rate
  is a corpus metric and should be described as one.
- **A second reviewer.** Reviewer throughput — records verified per hour — is a
  measurement about people, and this pilot had none.
