import Papa from 'papaparse';
import ExcelJS from 'exceljs';

/**
 * Reading a spreadsheet an operator actually has.
 *
 * The files that arrive in this workflow are exports from someone else's
 * system: a BOM at the front, a header row that is not row one, Hebrew column
 * names, dates as text, phone numbers Excel has helpfully turned into numbers
 * and stripped the leading zero from. None of that is exotic and all of it
 * silently corrupts an import that assumes a clean file.
 */

export type Sheet = {
  headers: string[];
  /** One record per row, keyed by header. Values are trimmed strings. */
  rows: Record<string, string>[];
};

export const MAX_IMPORT_ROWS = 5000;

export async function readSpreadsheet(file: {
  name: string;
  buffer: ArrayBuffer;
}): Promise<Sheet> {
  const isExcel = /\.xlsx?$/i.test(file.name);
  return isExcel ? readExcel(file.buffer) : readCsv(file.buffer);
}

function readCsv(buffer: ArrayBuffer): Sheet {
  // `TextDecoder('utf-8')` drops a BOM, which otherwise becomes part of the
  // first header and makes that column impossible to map.
  const text = new TextDecoder('utf-8').decode(buffer);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  const rows = (parsed.data ?? [])
    .map((row) => normaliseRow(row, headers))
    .filter(hasAnyValue)
    .slice(0, MAX_IMPORT_ROWS);

  return { headers, rows };
}

async function readExcel(buffer: ArrayBuffer): Promise<Sheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, index) => {
    headers[index - 1] = cellText(cell.value).trim();
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    if (rows.length >= MAX_IMPORT_ROWS) return;

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = cellText(row.getCell(index + 1).value).trim();
    });
    if (hasAnyValue(record)) rows.push(record);
  });

  return { headers: headers.filter(Boolean), rows };
}

/**
 * A cell as the person who typed it meant it.
 *
 * Dates become ISO rather than a locale string, and numbers keep their digits
 * as typed — `toString()` on a number Excel decided was numeric is how
 * `03-6100000` becomes `36100000` and stops being a phone number.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;

  const rich = value as {
    text?: string;
    result?: unknown;
    richText?: { text: string }[];
    hyperlink?: string;
  };
  if (Array.isArray(rich.richText)) return rich.richText.map((part) => part.text).join('');
  if (typeof rich.text === 'string') return rich.text;
  if (rich.result !== undefined) return cellText(rich.result);
  if (typeof rich.hyperlink === 'string') return rich.hyperlink;
  return '';
}

function normaliseRow(
  row: Record<string, string>,
  headers: string[],
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const header of headers) {
    const value = row[header];
    record[header] = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
  }
  return record;
}

function hasAnyValue(row: Record<string, string>): boolean {
  return Object.values(row).some((value) => value !== '');
}
