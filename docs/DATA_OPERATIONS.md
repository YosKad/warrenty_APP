# Data operations

How warranty, importer and service data gets into MY Warranty, who is allowed to
touch it, and what the system refuses to do on its own.

The product's constraint stopped being code somewhere around Phase H. The
resolver can answer "what warranty applies, who honours it, who repairs it, how
do I reach them" and then correctly refuses to, because the tables behind it are
empty. This document describes the machine that fills them.

---

## 1. The console

`apps/admin` — Next.js, TypeScript, desktop-first. Internal only.

```bash
cp apps/admin/.env.example apps/admin/.env.local   # fill in URL and anon key
npm install
npm run dev --workspace @mw/admin
```

Note what is *not* in that env file: `SUPABASE_SERVICE_ROLE_KEY`. The console
talks to the database as the signed-in reviewer, using the anon key plus their
session, so every read and every write goes through the same RLS policies that
protect this data from ordinary users.

That is the main security decision in the whole application. A routing mistake,
a missing guard, a forgotten `disabled` on a button — none of them can turn into
unauthorised access, because the database refuses the request regardless of what
the UI thinks. The guards in `lib/auth.ts` exist so people see a sensible screen.

## 2. Who can do what

Membership lives in `admin_members`, which has **no INSERT and no UPDATE policy
at all**. Nothing reachable from a browser can create a membership or change a
role; it is granted out of band with the service role:

```sql
insert into admin_members (user_id, role, note)
values ('<user id>', 'reviewer', 'granted by <who>, <when>, <why>');
```

| Role | Read | Edit records | Verify and publish | Grant membership |
| --- | :-: | :-: | :-: | :-: |
| `viewer` | ✓ | | | |
| `data_editor` | ✓ | ✓ | | |
| `reviewer` | ✓ | ✓ | ✓ | |
| `admin` | ✓ | ✓ | ✓ | ✓ (out of band) |

Enforced in three places, and the order matters: RLS policies keyed on
`is_admin(role)`, a `before insert or update` trigger for the promotion rule,
and the console's own checks. Only the first two are load-bearing.

Revoking sets `revoked_at` rather than deleting the row. `is_admin()` ignores
revoked members, and the row survives so the audit trail still resolves who did
what.

## 3. The publication workflow

Every table that carries global data has a `publication_status`, orthogonal to
`verification`. They answer different questions: `verification` is *how good is
this fact*, `publication_status` is *where is it in the workflow*. A row can be
`official` and `candidate` at once — an importer's own PDF that nobody has
reviewed yet.

```
   candidate ──┬──▶ needs_review ──▶ verified ──▶ published
               │                        ▲             │
               └────────────────────────┘             ▼
                                             needs_reverification
   (rejected and archived exit from anywhere they make sense)
```

- **Only `published` + `production` is visible to the resolver.**
  `match_warranty_policies()` filters on both, and `published_warranties` is the
  view that states it.
- **New rows default to `candidate`.** Including anything an extractor writes.
- **Only a reviewer may write `verified` or `published`**, enforced by a database
  trigger, not by which buttons the console renders. The trigger also stamps
  `reviewed_by` from the session, so the console cannot forget to.
- **`candidate → verified` is legal in one step.** `needs_review` is a queue, not
  a mandatory stop; a reviewer who has just read a clause against its source
  should not have to park it in a queue addressed to themselves.

## 4. What machines may and may not do

> AI must not independently publish trusted global data.

Implemented, not just stated:

| Step | Who | Result |
| --- | --- | --- |
| Fetch or receive a document | machine | `warranty_sources` + a snapshot |
| Split into clauses, store verbatim text | machine | `warranty_terms`, `candidate` |
| Classify and summarise each clause | model | derived fields on the same rows |
| Read the clause against its source | **person** | `verified` |
| Make it live | **person, reviewer** | `published` |

`warranty-extract` writes `publication_status: 'candidate'` explicitly rather
than relying on the column default — it runs with the service role, which
bypasses RLS and the trigger alike, so that one line is what stands between a
model's reading of a PDF and a user being told it is their warranty.

The clause review screen puts the verbatim document text on the left, not
editable, and the model's title, type and summary on the right. Approving means
a person read both halves together. Editing the derived layer flips
`verification` to `verified`, because a reviewer's own words are not an
extraction.

**There is no crawler.** Extraction reads documents it was pointed at — a URL an
operator entered or a file they uploaded. A process that wanders the web
collecting warranty pages produces a corpus nobody can vouch for.

## 5. Getting data in

### One record at a time

`/organisations`, `/relationships`, `/warranties`, and the provider sub-records
reached from an organisation's page. Every optional field starts blank and saves
as `null`. There are no defaults anywhere in `lib/fields.ts` — no twelve-month
term, no assumed country, no "official" flag — because a default is how a blank
column becomes a confident wrong answer.

### In bulk

`/import` takes CSV, XLS and XLSX for five targets. Four steps, each of which
shows its result before the next runs:

1. **Read.** Strips the BOM Excel puts at the front, reads Hebrew headers and
   values, returns dates as ISO, keeps `03-6100000` as text rather than letting
   a number conversion eat the leading zero.
2. **Map.** Guessed from the headers in English and Hebrew, offered for
   correction. Never applied silently — a column called "Phone" that means the
   fax is not something an alias table can know.
3. **Validate.** Every row, with its reasons. Nothing is written. A row that
   cannot be read is recorded and skipped, never coerced into something
   plausible.
4. **Import.** Only rows marked valid, all as candidates.

Organisations referenced by a contact or a branch are looked up by name and
**never created as a side effect** — a typo would otherwise silently produce a
second company nobody meant to exist.

### Duplicates

Found, scored, explained, and never merged. `scoreOrganisationDuplicate` treats a
matching company registration number as decisive and two *different* ones as
positive evidence of distinctness strong enough to overrule an identical name —
franchise networks really do register separate companies under one brand.
Everything else accumulates, because no single soft signal should be able to
declare a duplicate in a small market.

The two buttons are "different company" and "already have it". Neither writes
over anything. The losing side of an automatic merge is often the
better-researched record, and once it is gone there is no way to find that out.

## 6. Keeping it true

### Freshness, per class

| Class | Re-check after | Stale after |
| --- | ---: | ---: |
| provider contact | 180 d | 365 d |
| opening hours | 180 d | 365 d |
| service location | 270 d | 540 d |
| service capability | 365 d | 730 d |
| importer relationship | 365 d | 730 d |
| warranty policy | 540 d | 1095 d |

Stored in `freshness_policies` so they are data rather than constants. One global
interval would be wrong in both directions at once: a phone number unchecked for
a year is probably dead, a warranty policy unchecked for a year almost certainly
is not.

`unknown` is its own state, not a synonym for stale. A record nobody ever
verified needs a first look; one verified two years ago needs a second one.

### Re-verification

`/queues/stale` offers two buttons and the distinction is the point:

- **Still correct** moves `verified_at` and nothing else, so a record confirmed
  unchanged stays distinguishable from one that was rewritten.
- **Needs a look** moves it to `needs_reverification`, out of the published set,
  until a person has been.

Nothing on that page refetches anything. A machine that re-reads a page and
finds different words on it has found a reason for a person to look — not
permission to overwrite what a person previously confirmed.

### Conflicts

Two comparable sources disagreeing is a finding, not an error.
`/queues/conflicts` records which policy was chosen and why and **never deletes
the one that lost**: delete it and the next person rediscovers the disagreement
from scratch and may land somewhere else. "Both apply" is offered as a real
answer and requires a note saying which is which, because a user shown two
policies and no way to tell them apart has been given less than one.

### User reports

The highest-signal input the system gets — somebody rang a number and it did not
answer — and the most dangerous to apply automatically. Accepting a report marks
it acted on; it does not copy the user's suggested value into the global record.
"This number is dead" is strong evidence that a person should look and no
evidence at all about what the right number is.

## 7. Demo data

Fixtures are marked `data_environment = 'demo'` by the seed files themselves, and
`visible_environments()` returns production only. A development database can opt
itself in:

```sql
alter database postgres set app.include_demo_data = 'on';
```

Unset — which is every production deployment, because it takes a deliberate
statement to set — the resolver never sees a fixture. This is structural. The
warning banner at the top of `seed_demo_warranty.sql` is a comment, and a comment
has never stopped a row being served to a user.

## 8. Audit

`audit_logs` is readable by admins and writable by nobody. Entries go in through
`log_admin_action()`, a `security definer` function that stamps the actor from
the session rather than trusting a parameter — a client that can write the audit
log can rewrite the record of what it did.

Every mutation in the console goes through `lib/actions/records.ts`, which reads
the before state *first*. An audit entry recording only the new value answers the
least interesting half of the question.

One detail worth keeping: an update that matched no rows is reported as a
refusal, not a success. RLS declines by returning nothing rather than by raising,
so `data === null` after an update is the database saying no.

## 9. Measuring whether any of it worked

`/resolution` runs a hypothetical receipt through the corpus. Five stages —
product identified, warranty resolved, provider resolved, service route
resolved, contact actionable — and the Full Resolution Rate is the share of
cases that clear **all five**. A warranty resolved against a provider nobody can
reach is not a resolved warranty.

The partial rates sit underneath it because they tell an operator which table to
go and fill in. They are never reported instead of it.

`probe_resolution()` reads the database and returns provider facts per candidate
policy; which policy leads is decided by `rankCandidates` from `@mw/domain`, the
same function the app uses. A tester that ranked differently would be measuring
something nobody experiences.

Every run stores whether its cases were real or synthetic, and the console labels
it on every row. See `docs/ISRAEL_CORPUS_PILOT.md` for what the distinction is
worth — briefly: a synthetic suite measures the corpus, not the product.

## 10. Where the shared logic lives

`packages/domain` (`@mw/domain`) holds the scoring, the trust hierarchy, the
conflict rules, normalisation, freshness and the resolution evaluator. The mobile
app re-exports it and the console imports it, so a reviewer approving a policy is
making a prediction about what a user's phone will show — and two copies of the
weights is how that prediction quietly stops being true.

`warranty-resolve` runs on Deno inside Supabase and cannot import the package;
Edge Function bundling does not reach outside `supabase/functions`. It carries a
transcription, and `parity.test.ts` reads that file as text and asserts the
weights, thresholds and source hierarchy still agree. The comment saying "change
both" does not fail a build; the test does.

## 11. Running the tests

```bash
npm test                                   # domain package + console
npx jest --config apps/mobile/jest.config.js   # mobile
psql -d mw -f supabase/tests/admin_authorization_test.sql
psql -d mw -f supabase/tests/publication_workflow_test.sql
psql -d mw -f supabase/tests/warranty_matching_test.sql
psql -d mw -f supabase/tests/service_route_test.sql
```

The SQL suites impersonate real requests — `set local role authenticated` plus
the JWT claim GoTrue sets — and check row counts, not just the absence of an
error. An UPDATE blocked by RLS affects zero rows silently, and reading that as
success would let the whole suite pass against a database with no policies at
all.
