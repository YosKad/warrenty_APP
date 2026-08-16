import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { readSpreadsheet } from './spreadsheet';

const csv = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe('readSpreadsheet — CSV', () => {
  it('reads a plain file', async () => {
    const sheet = await readSpreadsheet({
      name: 'orgs.csv',
      buffer: csv('name,country\nSamline,IL\nNew Pan,IL\n'),
    });

    expect(sheet.headers).toEqual(['name', 'country']);
    expect(sheet.rows).toEqual([
      { name: 'Samline', country: 'IL' },
      { name: 'New Pan', country: 'IL' },
    ]);
  });

  it('survives the BOM every Excel export starts with', async () => {
    // Without this the first header becomes "﻿name" and can never be mapped.
    const sheet = await readSpreadsheet({
      name: 'orgs.csv',
      buffer: csv('﻿name,country\nSamline,IL\n'),
    });
    expect(sheet.headers[0]).toBe('name');
  });

  it('reads Hebrew headers and values', async () => {
    const sheet = await readSpreadsheet({
      name: 'orgs.csv',
      buffer: csv('שם,עיר\nמעבדת שירות,תל אביב\n'),
    });
    expect(sheet.headers).toEqual(['שם', 'עיר']);
    expect(sheet.rows[0]).toEqual({ שם: 'מעבדת שירות', עיר: 'תל אביב' });
  });

  it('drops blank rows without dropping rows that are merely sparse', async () => {
    const sheet = await readSpreadsheet({
      name: 'orgs.csv',
      buffer: csv('name,country\nSamline,IL\n,\nNew Pan,\n'),
    });
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[1]).toEqual({ name: 'New Pan', country: '' });
  });

  it('trims the padding people leave in spreadsheet cells', async () => {
    const sheet = await readSpreadsheet({
      name: 'orgs.csv',
      buffer: csv('name , country\n  Samline  ,  IL \n'),
    });
    expect(sheet.headers).toEqual(['name', 'country']);
    expect(sheet.rows[0]).toEqual({ name: 'Samline', country: 'IL' });
  });
});

describe('readSpreadsheet — XLSX', () => {
  async function workbookBuffer(
    rows: (string | number | Date | null)[][],
  ): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    for (const row of rows) sheet.addRow(row);
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as ArrayBuffer;
  }

  it('reads a real workbook, not a renamed CSV', async () => {
    const buffer = await workbookBuffer([
      ['name', 'city', 'opened'],
      ['Samline Service', 'תל אביב', new Date(Date.UTC(2024, 2, 1))],
    ]);

    const sheet = await readSpreadsheet({ name: 'branches.xlsx', buffer });

    expect(sheet.headers).toEqual(['name', 'city', 'opened']);
    expect(sheet.rows[0]).toEqual({
      name: 'Samline Service',
      city: 'תל אביב',
      // ISO, not a locale string — a date read as "3/1/2024" is a date read
      // ambiguously.
      opened: '2024-03-01',
    });
  });

  it('keeps a phone number that Excel stored as text', async () => {
    const buffer = await workbookBuffer([
      ['phone'],
      ['03-6100000'],
    ]);
    const sheet = await readSpreadsheet({ name: 'contacts.xlsx', buffer });
    expect(sheet.rows[0]!.phone).toBe('03-6100000');
  });

  it('returns nothing rather than throwing on an empty sheet', async () => {
    const buffer = await workbookBuffer([]);
    const sheet = await readSpreadsheet({ name: 'empty.xlsx', buffer });
    expect(sheet.rows).toEqual([]);
  });
});
