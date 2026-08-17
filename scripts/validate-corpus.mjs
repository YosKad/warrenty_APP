#!/usr/bin/env node
/**
 * Checks a corpus package before anybody uploads it.
 *
 * Runs the console's own validators — the same `TARGETS` definitions, the same
 * provenance rules — so a researcher gets the same verdict at their desk that
 * the import wizard would give them, without needing an account or a database.
 *
 *   node scripts/validate-corpus.mjs corpus/israel/samsung
 *
 * It checks the things a person cannot check by eye: whether every row parses,
 * whether the cross-references resolve *within the package*, and whether any
 * row claims more trust than its source supports.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { normaliseName, parseModel } from '../packages/domain/src/index.ts';
import { readSpreadsheet } from '../apps/admin/src/lib/import/spreadsheet.ts';
import { TARGETS, applyMapping, guessMapping } from '../apps/admin/src/lib/import/targets.ts';
import { readProvenance } from '../apps/admin/src/lib/import/provenance.ts';

/** File name → import target, and the order they have to be imported in. */
const FILES = [
  ['organisations.csv', 'organisations'],
  ['organisation_aliases.csv', 'organisation_aliases'],
  ['sources.csv', 'warranty_sources'],
  ['models.csv', 'product_models'],
  ['model_aliases.csv', 'model_aliases'],
  ['relationships.csv', 'organisation_relationships'],
  ['contacts.csv', 'provider_contacts'],
  ['locations.csv', 'service_locations'],
  ['capabilities.csv', 'service_capabilities'],
];

const directory = process.argv[2];
if (!directory || !existsSync(directory)) {
  console.error('usage: node scripts/validate-corpus.mjs <package directory>');
  process.exit(2);
}

const known = {
  organisations: new Set(),
  models: new Set(),
};

let totalRows = 0;
let totalErrors = 0;
let exampleRows = 0;

console.log(`\n=== ${directory} ===\n`);

const present = new Set(readdirSync(directory).filter((name) => name.endsWith('.csv')));
for (const name of present) {
  if (!FILES.some(([file]) => file === name)) {
    console.log(`  ${name.padEnd(26)} ⚠ not part of the contract — it will be ignored`);
  }
}

for (const [file, target] of FILES) {
  const path = join(directory, file);
  if (!existsSync(path)) continue;

  const bytes = readFileSync(path);
  const sheet = await readSpreadsheet({
    name: basename(path),
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });

  const spec = TARGETS[target];
  const mapping = guessMapping(target, sheet.headers);

  const unmapped = spec.fields
    .filter((field) => field.required && !mapping[field.key])
    .map((field) => field.label);

  const problems = [];

  sheet.rows.forEach((raw, index) => {
    totalRows += 1;
    const line = index + 2;
    const mapped = applyMapping(mapping, raw);
    const { values, errors } = spec.validate(mapped);
    const provenance = readProvenance(mapped);

    for (const note of provenance.notes) errors.push(note);

    if ((mapped.researcher ?? '').includes('EXAMPLE ROW')) {
      exampleRows += 1;
      errors.push('This is the template example row. Delete it.');
    }

    // Cross-references, checked within the package. The console checks them
    // against the database as well; checking here means a researcher finds a
    // typo before they need an account.
    for (const field of ['organisation', 'subject', 'object', 'manufacturer']) {
      const value = mapped[field];
      if (!value) continue;
      if (target === 'organisations') continue;
      if (!known.organisations.has(normaliseName(value))) {
        errors.push(
          `“${value}” is not in organisations.csv — add it there, or check the spelling`,
        );
      }
    }

    if (target === 'model_aliases' && mapped.canonical_model) {
      const key = parseModel(mapped.canonical_model, {
        brands: [mapped.manufacturer ?? ''],
      }).normalised;
      if (!known.models.has(key)) {
        errors.push(`“${mapped.canonical_model}” is not in models.csv`);
      }
    }

    // Record what this file defines, for the files that come after it.
    if (target === 'organisations' && values.name) {
      known.organisations.add(normaliseName(String(values.name)));
    }
    if (target === 'organisation_aliases' && values.normalized_key) {
      known.organisations.add(String(values.normalized_key));
    }
    if (target === 'product_models' && values.normalized_key) {
      known.models.add(String(values.normalized_key));
    }

    if (errors.length > 0) {
      totalErrors += errors.length;
      problems.push({ line, errors });
    }
  });

  const status = problems.length === 0 ? 'ok' : `${problems.length} rows with problems`;
  console.log(
    `  ${file.padEnd(26)} ${String(sheet.rows.length).padStart(4)} rows  ` +
      `${Object.keys(mapping).length} columns recognised  ${status}`,
  );

  if (unmapped.length > 0) {
    console.log(`      ✗ missing required columns: ${unmapped.join(', ')}`);
  }
  for (const problem of problems.slice(0, 10)) {
    for (const error of problem.errors) {
      console.log(`      row ${String(problem.line).padStart(4)}  ${error}`);
    }
  }
  if (problems.length > 10) {
    console.log(`      … and ${problems.length - 10} more rows`);
  }
}

console.log(
  `\n  ${totalRows} rows, ${totalErrors} problem${totalErrors === 1 ? '' : 's'}` +
    (exampleRows > 0 ? ` (${exampleRows} of them are the template's example rows)` : ''),
);
console.log(
  totalErrors === 0
    ? '  Ready to import. Everything will arrive as a candidate for review.\n'
    : '  Fix these and run it again. Nothing here has touched a database.\n',
);

process.exit(totalErrors === 0 ? 0 : 1);
