# Corpus import contract

What an external research process should produce so the data operations console
can validate, review, import, resolve, update and audit it — without anybody
writing code for it.

Templates: `corpus/israel/_template/`. Validator: `npm run corpus:validate --
<directory>`.

---

## 1. Shape

A package is a directory of UTF-8 CSV files, one per record type:

```
corpus/<country>/<brand>/
  organisations.csv
  organisation_aliases.csv
  sources.csv
  models.csv
  model_aliases.csv
  relationships.csv
  contacts.csv
  locations.csv
  capabilities.csv
```

Every file is optional. A package containing only `contacts.csv` is a good
package — and, on the pilot's evidence, a more valuable one than a package
containing only warranty terms, because withholding contacts took the Full
Resolution Rate to zero while withholding clauses changed nothing.

**Header on row one.** Column names may be English or Hebrew; both are
recognised. Anything unrecognised is mapped by hand in the console, so a
non-standard header is an inconvenience rather than a rejection.

**Import in the order listed above.** Later files reference earlier ones *by
name*, and a row naming an organisation that does not exist is an error — never
a reason to create one. A typo would otherwise silently produce a second company
nobody meant to exist.

## 2. Provenance — the part that matters

**Every file accepts these columns, and every substantive claim should carry
them.**

| Column | Meaning |
| --- | --- |
| `source_url` | the page or document this fact came from |
| `source_title` | what that document is called |
| `source_kind` | `manufacturer` · `retailer` · `internal_db` · `document_extraction` · `user_entered` · `ai_inferred` |
| `retrieved_date` | when it was read (ISO, or `dd/mm/yyyy` — read day-first) |
| `verification` | `unverified` · `community_submitted` · `verified` · `official` |
| `researcher` | who found it |
| `source_excerpt` | the sentence it came from |
| `content_hash` | of the document, where one is available |

### The rule

> **No row becomes trusted because it arrived in a spreadsheet.**

A CSV can assert anything — that a warranty is 60 months, that a term is
`official` — and the file itself is no evidence at all. So:

- A `verification` above `unverified` **requires a source reference**. Without
  one the row still imports, but as `unverified`, and the import report says why.
- Everything imported arrives as **`publication_status = 'candidate'`**,
  regardless of what the file claims. A package cannot publish itself.
- Promotion to `verified` or `published` is a **reviewer's** act, enforced by a
  database trigger rather than by which buttons the console renders.

`source_excerpt` is worth filling in even though nothing validates it. It is the
difference between a reviewer opening a 40-page PDF and a reviewer reading one
sentence.

## 3. The files

Required columns are **bold**. Everything else is optional, and blank always
means *unknown* — never a default.

### organisations.csv

| Column | Notes |
| --- | --- |
| **`name`** | as the company is normally written |
| `legal_name` | as registered. Hebrew is fine |
| `roles` | comma-separated: `manufacturer`, `importer`, `retailer`, `warranty_provider`, `service_provider` |
| `country` | two letters |
| `website`, `phone`, `email` | |

One Israeli company is routinely importer, warranty provider and repairer at
once; list every role it actually holds. Who it acts *for* is a separate file.

### organisation_aliases.csv

| Column | Notes |
| --- | --- |
| **`organisation`** | must exist in `organisations.csv` |
| **`alias`** | the other spelling |
| `kind` | `trading_name` · `legal_name` · `brand` · `abbreviation` · `transliteration` · `receipt_text` |
| `country` | |

This is the file that lets a Hebrew receipt reach an English corpus. It is also
where **brand, importer and corporate parent stay separate**: "BSH" is an alias
of the importer, not of Bosch. An alias always points at exactly one company.

### sources.csv

| Column | Notes |
| --- | --- |
| **`title`** | |
| `url`, `organisation`, `kind`, `version`, `language`, `country` | |
| `effective_from` | when the document's terms took effect |
| `content_hash` | lets a later fetch prove the document changed |

### models.csv

| Column | Notes |
| --- | --- |
| **`manufacturer`** | the company that *makes* it — not the importer, not the parent |
| **`model`** | the canonical name, e.g. `Samsung S95D` |
| `family` | the product line: `S95`, `MacBook Air`, `V15` |
| `variant` | what distinguishes this member: `Detect Absolute`, `13-inch` |
| `regional_model` | the market part number, e.g. `QE65S95DATXXH` |
| `country` | |

The comparison key is **computed by the importer** using the same parser the app
uses. A researcher never has to work it out and it cannot drift from the
algorithm.

### model_aliases.csv

| Column | Notes |
| --- | --- |
| **`manufacturer`**, **`model`** | must exist in `models.csv` |
| **`alias`** | another way the product is written |
| `kind` | `trading_name` · `regional_code` · `abbreviation` · `retailer_name` · `ocr_variant` · `legacy` |

**This is the highest-value file in a package.** Structure gets from
`QE65S95DATXXH` to `S95D` on its own; nothing gets from `MBA M4` to
`MacBook Air M4` without somebody recording it. A model with no aliases is
findable only by someone who types its name exactly as a reviewer wrote it.

Include every market's part number, the retailer's listing name, and any
abbreviation that appears on receipts.

### relationships.csv

| Column | Notes |
| --- | --- |
| **`subject`** | the company acting |
| **`kind`** | `imports_for` · `warranty_provider_for` · `services_for` · `authorized_service_for` · `retails_for` · `subsidiary_of` |
| **`object`** | the company it acts for |
| `country`, `category`, `model_pattern`, `channel` | scope |
| `from`, `to` | dates |

A blank scope means **not narrowed**, which is not the same as *everywhere*. A
relationship with no country recorded will not be used to claim a company imports
for a brand in a country nobody checked.

Leave `to` blank while a relationship is current. When it ends, set it — do not
delete the row. A product bought in 2024 is still governed by whoever held the
agreement in 2024.

### contacts.csv

| Column | Notes |
| --- | --- |
| **`organisation`**, **`kind`**, **`value`** | `phone` · `whatsapp` · `email` · `web_form` · `website` · `chat` · `app` · `address` |
| `purpose` | `warranty_claim` · `technical_support` · `customer_service` · `appointment_booking` · `spare_parts` · `sales` · `general` |
| `label`, `country`, `hours` | |

Leave `purpose` blank if the provider does not say. A guessed purpose sends
people to the wrong desk, and a general switchboard is not a warranty line.

`hours` is free text, recorded as published. It is not parsed and never guessed.

### locations.csv

| Column | Notes |
| --- | --- |
| **`organisation`** | |
| `branch`, `country`, `region`, `city`, `address`, `postal_code`, `phone` | at least a city or an address |
| `latitude`, `longitude` | **both or neither** — half a coordinate points at the wrong place with total confidence |
| `timezone` | e.g. `Asia/Jerusalem`. Hours resolve in the branch's own zone |
| `appointment` | `yes` / `no` |

### capabilities.csv

| Column | Notes |
| --- | --- |
| **`organisation`**, **`capability`** | twelve kinds — see the console's dropdown |
| `availability` | `yes` / `no` / blank |
| `country`, `region`, `lead time`, `fee` | |

**Blank availability reads as "not confirmed", never as "no."** That is the
honest answer far more often than either of the others, and the app shows it as
such.

## 4. What the importer does

```
  Read  →  Map  →  Validate  →  Preview  →  Import as candidate
```

Each step shows its result before the next runs, and **nothing reaches the
corpus until the last one**.

- **Read** strips the BOM Excel writes, reads Hebrew headers and values, returns
  dates as ISO, and keeps `03-6100000` as text instead of letting a number
  conversion eat the leading zero.
- **Map** is guessed from the headers and offered for correction, never applied
  silently. A column called "Phone" that means the fax is not something an alias
  table can know.
- **Validate** checks every row and reports every reason. A row that cannot be
  read is recorded and skipped, never coerced into something plausible. Nothing
  is written.
- **Duplicates** are found, scored and explained — and never merged. The two
  buttons are "different company" and "already have it"; neither overwrites
  anything, because the losing side of an automatic merge is often the
  better-researched record.
- **Import** creates candidates.

Run the validator first and none of this needs a database:

```bash
npm run corpus:validate -- corpus/israel/samsung
```

It runs the console's own validators and its own provenance rules, checks
cross-references *within* the package, and exits non-zero if anything is wrong.

## 5. Updating and superseding

A package can be re-imported. Nothing is destroyed:

- A row that matches an existing record is flagged as a duplicate for review,
  not overwritten.
- A reviewer replacing a candidate with a verified record archives the old one —
  `archived`, not deleted, so the audit trail still resolves.
- Historical provenance is never rewritten. A record verified from one source and
  later corrected from another keeps both, and `audit_logs` holds the before and
  after of every change with the reason.
- Demo fixtures are marked `data_environment = 'demo'` and are excluded from the
  resolver structurally. A production package supersedes them by existing; the
  fixtures never need deleting, and never surface as production data.

## 6. What a good package looks like

From the pilot's ablation table, in the order that buys the most:

1. **`relationships.csv`** — who imports and who repairs, per brand and country.
2. **`contacts.csv`** — one actionable contact for the company that honours the
   warranty. Withholding this took the Full Resolution Rate from 50% to zero.
3. **`models.csv` + `model_aliases.csv`** — so a receipt can be recognised at all.
4. **`locations.csv` / `capabilities.csv`** — the service route.
5. **`sources.csv`** — so all of the above can be checked.

Warranty terms and clauses are the Phase G product and are worth having. They
are not what makes the difference between a user getting an answer and not.
