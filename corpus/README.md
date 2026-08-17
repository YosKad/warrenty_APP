# Corpus packages

Externally researched warranty and service data, in the shape the console can
import without anybody writing code for it.

```
corpus/
  israel/
    _template/        header rows plus one example row, marked as an example
    samsung/          one directory per brand
    apple/
    dyson/
```

A package is a directory of CSV files. Every file is optional; a package with
only `contacts.csv` is a perfectly good package, and — given what the pilot
measured — a more useful one than a package with only `warranties.csv`.

**Import them in this order.** Later files reference earlier ones by name, and a
row pointing at an organisation that does not exist yet is an error rather than
a reason to create one:

1. `organisations.csv`
2. `organisation_aliases.csv`
3. `sources.csv`
4. `models.csv`
5. `model_aliases.csv`
6. `relationships.csv`
7. `contacts.csv`
8. `locations.csv`
9. `capabilities.csv`

Everything imported arrives as a **candidate**. Nothing in a package can publish
itself, and no row becomes trusted because it was in a spreadsheet — see
`docs/CORPUS_IMPORT_CONTRACT.md` for the exact rules, the full column list, and
what happens to a row that claims more than its source supports.

Check a package before uploading it:

```bash
node scripts/validate-corpus.mjs corpus/israel/samsung
```

The example rows in `_template` all carry `researcher: EXAMPLE ROW — DELETE ME`
and point at `example.invalid`. They are there to show the shape. Delete them.
