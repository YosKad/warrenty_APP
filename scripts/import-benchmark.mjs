#!/usr/bin/env node
/**
 * How fast is the mechanical half?
 *
 * The pilot needs an honest split between the part a person does — finding out
 * who imports a brand and what the terms say — and the part the machine does.
 * Only the second is measurable here, so it is the only one this script
 * produces a number for.
 *
 *   npm run bench:import
 *
 * Generates a spreadsheet of the shape an operator would actually hand over,
 * then reads and validates it through exactly the code the console runs.
 */

import { performance } from 'node:perf_hooks';
import ExcelJS from 'exceljs';

import { readSpreadsheet } from '../apps/admin/src/lib/import/spreadsheet.ts';
import { TARGETS, applyMapping, findDuplicate, guessMapping } from '../apps/admin/src/lib/import/targets.ts';

const ROWS = Number(process.argv[2] ?? 500);

const CITIES = ['תל אביב', 'חיפה', 'ירושלים', 'באר שבע', 'ראשון לציון', 'נתניה'];
const STREETS = ['הרצל', 'ויצמן', 'אלנבי', 'דיזנגוף', 'בן גוריון'];

function csvFile(rows) {
  const header = 'חברה,סניף,עיר,כתובת,טלפון,lat,lng\n';
  const body = rows
    .map(
      (index) =>
        `Samline,סניף ${index},${CITIES[index % CITIES.length]},${
          STREETS[index % STREETS.length]
        } ${index},03-${String(5000000 + index).padStart(7, '0')},${(31 + (index % 200) / 100).toFixed(4)},${(34 + (index % 300) / 100).toFixed(4)}`,
    )
    .join('\n');
  return new TextEncoder().encode(header + body + '\n').buffer;
}

async function xlsxFile(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('branches');
  sheet.addRow(['חברה', 'סניף', 'עיר', 'כתובת', 'טלפון', 'lat', 'lng']);
  for (const index of rows) {
    sheet.addRow([
      'Samline',
      `סניף ${index}`,
      CITIES[index % CITIES.length],
      `${STREETS[index % STREETS.length]} ${index}`,
      `03-${String(5000000 + index).padStart(7, '0')},`,
      31 + (index % 200) / 100,
      34 + (index % 300) / 100,
    ]);
  }
  return workbook.xlsx.writeBuffer();
}

const indices = Array.from({ length: ROWS }, (_, index) => index + 1);
const spec = TARGETS.service_locations;

async function bench(name, file) {
  const readStart = performance.now();
  const sheet = await readSpreadsheet(file);
  const readMs = performance.now() - readStart;

  const mapping = guessMapping('service_locations', sheet.headers);
  const mappedFields = Object.keys(mapping).length;

  const validateStart = performance.now();
  let valid = 0;
  const values = [];
  for (const raw of sheet.rows) {
    const result = spec.validate(applyMapping(mapping, raw));
    if (result.errors.length === 0) valid += 1;
    values.push(result.values);
  }
  const validateMs = performance.now() - validateStart;

  // Duplicate detection is quadratic against what already exists, which is the
  // part that decides whether this scales — so it is measured separately rather
  // than hidden inside the validation number.
  const existing = values.slice(0, Math.min(values.length, 200)).map((row, index) => ({
    ...row,
    id: `existing-${index}`,
  }));
  const dupStart = performance.now();
  let duplicates = 0;
  for (const row of values) {
    if (findDuplicate('service_locations', row, existing)) duplicates += 1;
  }
  const dupMs = performance.now() - dupStart;

  console.log(
    `  ${name.padEnd(6)} ${String(sheet.rows.length).padStart(5)} rows  ` +
      `read ${readMs.toFixed(0).padStart(5)} ms  ` +
      `validate ${validateMs.toFixed(0).padStart(4)} ms  ` +
      `duplicates ${dupMs.toFixed(0).padStart(5)} ms  ` +
      `(${mappedFields} columns mapped automatically, ${valid} valid, ${duplicates} flagged)`,
  );
}

console.log(`\n=== Bulk import, mechanical cost (${ROWS} rows, Hebrew headers) ===`);
await bench('CSV', { name: 'branches.csv', buffer: csvFile(indices) });
await bench('XLSX', { name: 'branches.xlsx', buffer: await xlsxFile(indices) });
console.log(
  '\n  Everything above is machine time. It is not the cost of the import — the\n' +
    '  cost of the import is producing the spreadsheet, and this script cannot\n' +
    '  measure that.\n',
);
