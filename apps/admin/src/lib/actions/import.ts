'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { normaliseName } from '@mw/domain';

import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { MAX_IMPORT_ROWS, readSpreadsheet } from '@/lib/import/spreadsheet';
import {
  TARGETS,
  applyMapping,
  findDuplicate,
  guessMapping,
  type ImportTarget,
} from '@/lib/import/targets';
import { readProvenance } from '@/lib/import/provenance';

/**
 * Bulk import.
 *
 * Four steps, and the operator sees the result of each before the next one
 * runs: read the file, agree the column mapping, validate every row, then
 * import. Nothing is written to the corpus until the last step, everything
 * written is a candidate, and a row that could not be read is recorded with its
 * reason rather than dropped — "412 of 500 imported" with no way to see the
 * other 88 is not an import, it is data loss with a progress bar.
 */

export type ImportActionResult = { ok: true; jobId?: string } | { ok: false; error: string };

export async function uploadImport(formData: FormData): Promise<ImportActionResult> {
  const identity = await requireAdmin('data_editor');

  const file = formData.get('file');
  const target = String(formData.get('target') ?? '') as ImportTarget;

  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a file.' };
  if (!Object.prototype.hasOwnProperty.call(TARGETS, target)) {
    return { ok: false, error: 'Choose what the file contains.' };
  }
  if (!/\.(csv|xlsx?)$/i.test(file.name)) {
    return { ok: false, error: 'Only .csv, .xls and .xlsx files can be read.' };
  }

  let sheet;
  try {
    sheet = await readSpreadsheet({ name: file.name, buffer: await file.arrayBuffer() });
  } catch (error) {
    return {
      ok: false,
      error: `That file could not be read: ${error instanceof Error ? error.message : 'unknown format'}`,
    };
  }

  if (sheet.rows.length === 0) {
    return { ok: false, error: 'No data rows found. Is the header on the first row?' };
  }

  const supabase = await supabaseServer();

  const { data: job, error: jobError } = await supabase
    .from('import_jobs')
    .insert({
      created_by: identity.userId,
      target,
      file_name: file.name,
      status: 'mapping',
      column_mapping: guessMapping(target, sheet.headers),
      total_rows: sheet.rows.length,
    })
    .select('id')
    .maybeSingle();

  if (jobError || !job) {
    return { ok: false, error: jobError?.message ?? 'The database declined the import.' };
  }

  // The raw row is stored as it arrived. Re-mapping later then costs nothing and
  // does not need the operator to find the file again.
  const rows = sheet.rows.slice(0, MAX_IMPORT_ROWS).map((raw, index) => ({
    job_id: job.id,
    row_number: index + 2, // +2: row 1 is the header, and spreadsheets count from 1
    raw,
  }));

  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error } = await supabase.from('import_rows').insert(rows.slice(offset, offset + 500));
    if (error) return { ok: false, error: error.message };
  }

  await supabase.rpc('log_admin_action', {
    p_action: 'import.upload',
    p_entity_type: 'import_jobs',
    p_entity_id: job.id,
    p_after: { target, file_name: file.name, total_rows: rows.length },
  });

  redirect(`/import/${job.id}`);
}

export async function saveMapping(
  jobId: string,
  mapping: Record<string, string>,
): Promise<ImportActionResult> {
  await requireAdmin('data_editor');
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from('import_jobs')
    .update({ column_mapping: mapping, status: 'mapping' })
    .eq('id', jobId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/import/${jobId}`);
  return { ok: true };
}

/**
 * Validates every row and looks for duplicates.
 *
 * Writes nothing to the corpus. The point of a separate pass is that the
 * operator can look at 88 errors and fix the spreadsheet, rather than
 * discovering them one at a time as records half-appear.
 */
export async function validateImport(jobId: string): Promise<ImportActionResult> {
  await requireAdmin('data_editor');
  const supabase = await supabaseServer();

  const { data: job } = await supabase
    .from('import_jobs')
    .select('id, target, column_mapping')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return { ok: false, error: 'That import no longer exists.' };

  const target = job.target as ImportTarget;
  const spec = TARGETS[target];
  const mapping = (job.column_mapping ?? {}) as Record<string, string>;

  const missing = spec.fields
    .filter((field) => field.required && !mapping[field.key])
    .map((field) => field.label);
  if (missing.length > 0) {
    return { ok: false, error: `Map these columns first: ${missing.join(', ')}` };
  }

  const { data: rows } = await supabase
    .from('import_rows')
    .select('id, row_number, raw')
    .eq('job_id', jobId)
    .order('row_number');

  // Organisations are looked up by name, never created as a side effect of
  // importing a phone number: a typo would otherwise silently produce a second
  // company nobody meant to exist.
  const { data: organisations } = await supabase
    .from('organisations')
    .select('id, name, legal_name, country_code, website, support_phone')
    .limit(2000);

  const byName = new Map<string, string>();
  for (const org of organisations ?? []) {
    byName.set(normaliseName(org.name), org.id);
    if (org.legal_name) byName.set(normaliseName(org.legal_name), org.id);
  }

  // Approved aliases too, so a package written in Hebrew resolves against a
  // corpus written in English without the researcher having to translate.
  const { data: orgAliases } = await supabase
    .from('organisation_aliases')
    .select('organisation_id, normalized_key, publication_status, verification')
    .limit(4000);
  for (const alias of orgAliases ?? []) {
    const usable =
      (alias.publication_status === 'published' || alias.publication_status === 'verified') &&
      alias.verification !== 'unverified' &&
      alias.verification !== 'ai_extracted';
    if (usable && !byName.has(alias.normalized_key)) {
      byName.set(alias.normalized_key, alias.organisation_id);
    }
  }

  // Models, for the alias file that points at them.
  const { data: models } = await supabase
    .from('product_models')
    .select('id, canonical_model, normalized_key, manufacturer_id')
    .limit(4000);
  const modelByKey = new Map<string, string>();
  for (const model of models ?? []) {
    modelByKey.set(model.normalized_key, model.id);
    modelByKey.set(normaliseName(model.canonical_model), model.id);
  }

  const { data: locations } =
    spec.duplicateKey === 'location'
      ? await supabase
          .from('service_locations')
          .select('id, name, address_line, city, phone, country_code, latitude, longitude')
          .limit(5000)
      : { data: [] };

  const existing =
    spec.duplicateKey === 'organisation'
      ? ((organisations ?? []) as Record<string, unknown>[])
      : spec.duplicateKey === 'model'
        ? ((models ?? []) as Record<string, unknown>[])
        : ((locations ?? []) as Record<string, unknown>[]);

  let valid = 0;
  let invalid = 0;
  let duplicate = 0;

  for (const row of rows ?? []) {
    const mapped = applyMapping(mapping, row.raw as Record<string, string>);
    const { values, errors } = spec.validate(mapped);

    // Provenance decides what the row is allowed to claim. A spreadsheet
    // asserting "official" with nothing behind it asserts its own authority.
    const provenance = readProvenance(mapped);
    values.verification = provenance.verification;
    for (const note of provenance.notes) errors.push(note);

    // Resolve the owning organisation for the targets that need one.
    if (spec.fields.some((field) => field.key === 'organisation')) {
      const key = normaliseName(mapped.organisation ?? '');
      const id = key ? byName.get(key) : undefined;
      if (!id) {
        errors.push(
          `No organisation named “${mapped.organisation ?? ''}” exists. Create it before importing records that point at it.`,
        );
      } else {
        values.organisation_id = id;
      }
    }

    if (target === 'product_models' || target === 'model_aliases') {
      const manufacturer = byName.get(normaliseName(mapped.manufacturer ?? ''));
      if (!manufacturer) {
        errors.push(
          `No manufacturer named “${mapped.manufacturer ?? ''}” exists. Import organisations first.`,
        );
      } else if (target === 'product_models') {
        values.manufacturer_id = manufacturer;
      }
    }

    if (target === 'model_aliases') {
      const key = normaliseName(mapped.canonical_model ?? '');
      const parsedKey = mapped.canonical_model
        ? modelByKey.get(key) ??
          modelByKey.get(
            (spec.validate({ ...mapped, value: mapped.canonical_model }).values
              .normalized_key as string) ?? '',
          )
        : undefined;
      if (!parsedKey) {
        errors.push(
          `No model named “${mapped.canonical_model ?? ''}” exists. Import models before their aliases.`,
        );
      } else {
        values.model_id = parsedKey;
      }
    }

    if (target === 'warranty_sources' && mapped.organisation?.trim()) {
      const publisher = byName.get(normaliseName(mapped.organisation));
      if (!publisher) {
        errors.push(`No organisation named “${mapped.organisation}” exists`);
      } else {
        values.organisation_id = publisher;
      }
    }

    if (target === 'organisation_relationships') {
      const subject = byName.get(normaliseName(mapped.subject ?? ''));
      const object = byName.get(normaliseName(mapped.object ?? ''));
      if (!subject) errors.push(`No organisation named “${mapped.subject ?? ''}” exists`);
      if (!object) errors.push(`No organisation named “${mapped.object ?? ''}” exists`);
      if (subject) values.subject_id = subject;
      if (object) values.object_id = object;
    }

    const found = errors.length === 0 ? findDuplicate(target, values, existing) : null;

    const status = errors.length > 0 ? 'invalid' : found ? 'duplicate' : 'valid';
    if (status === 'invalid') invalid += 1;
    else if (status === 'duplicate') duplicate += 1;
    else valid += 1;

    await supabase
      .from('import_rows')
      .update({
        mapped: values,
        status,
        errors,
        duplicate_of: found?.existingId ?? null,
        duplicate_reason: found ? found.signals.map((s) => s.detail).join('; ') : null,
        // The column is numeric(4,3); the score is 0–100.
        duplicate_score: found ? found.score / 100 : null,
      })
      .eq('id', row.id);
  }

  await supabase
    .from('import_jobs')
    .update({
      status: 'preview',
      valid_rows: valid,
      invalid_rows: invalid,
      duplicate_rows: duplicate,
    })
    .eq('id', jobId);

  revalidatePath(`/import/${jobId}`);
  return { ok: true };
}

/**
 * Writes the valid rows.
 *
 * Only rows marked `valid` — invalid rows keep their errors and duplicates keep
 * their match, both for a person to work through. Everything created is a
 * candidate, so a bad import is a queue to reject rather than a corpus to
 * repair.
 */
export async function runImport(jobId: string): Promise<ImportActionResult> {
  await requireAdmin('data_editor');
  const supabase = await supabaseServer();

  const { data: job } = await supabase
    .from('import_jobs')
    .select('id, target, status, data_environment')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return { ok: false, error: 'That import no longer exists.' };
  if (job.status !== 'preview') {
    return { ok: false, error: 'Validate the file before importing it.' };
  }

  const spec = TARGETS[job.target as ImportTarget];

  const { data: rows } = await supabase
    .from('import_rows')
    .select('id, mapped')
    .eq('job_id', jobId)
    .eq('status', 'valid')
    .order('row_number');

  await supabase.from('import_jobs').update({ status: 'importing' }).eq('id', jobId);

  let imported = 0;
  const failures: string[] = [];

  for (const row of rows ?? []) {
    const values = {
      ...(row.mapped as Record<string, unknown>),
      publication_status: 'candidate',
      data_environment: job.data_environment,
    };

    const { data, error } = await supabase
      .from(spec.table)
      .insert(values)
      .select('id')
      .maybeSingle();

    if (error || !data) {
      await supabase
        .from('import_rows')
        .update({
          status: 'invalid',
          errors: [error?.message ?? 'The database declined this row'],
        })
        .eq('id', row.id);
      failures.push(error?.message ?? 'declined');
      continue;
    }

    await supabase
      .from('import_rows')
      .update({ status: 'imported', created_entity_id: data.id })
      .eq('id', row.id);
    imported += 1;
  }

  await supabase
    .from('import_jobs')
    .update({
      status: 'completed',
      imported_rows: imported,
      invalid_rows: (rows?.length ?? 0) - imported,
      error_summary: failures.length > 0 ? failures.slice(0, 5).join(' · ') : null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  await supabase.rpc('log_admin_action', {
    p_action: 'import.run',
    p_entity_type: 'import_jobs',
    p_entity_id: jobId,
    p_after: { imported, failed: failures.length, target: job.target },
  });

  revalidatePath(`/import/${jobId}`);
  return { ok: true };
}

/**
 * Marks a duplicate row as a distinct record after all, so it imports.
 *
 * The other direction — "yes, this is the same company" — is deliberately not a
 * button that merges. It simply leaves the row skipped, and whatever the
 * spreadsheet knew that the existing record does not is added by hand, by
 * someone who has looked at both.
 */
export async function resolveDuplicate(
  rowId: string,
  resolution: 'distinct' | 'skip',
): Promise<ImportActionResult> {
  await requireAdmin('data_editor');
  const supabase = await supabaseServer();

  const { data: row } = await supabase
    .from('import_rows')
    .select('id, job_id, duplicate_of')
    .eq('id', rowId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'That row no longer exists.' };

  const { error } = await supabase
    .from('import_rows')
    .update(
      resolution === 'distinct'
        ? { status: 'valid', duplicate_of: null, duplicate_reason: null, duplicate_score: null }
        : { status: 'skipped' },
    )
    .eq('id', rowId);

  if (error) return { ok: false, error: error.message };

  await supabase.rpc('log_admin_action', {
    p_action: `import.duplicate.${resolution}`,
    p_entity_type: 'import_rows',
    p_entity_id: rowId,
    p_before: { duplicate_of: row.duplicate_of },
  });

  revalidatePath(`/import/${row.job_id}`);
  return { ok: true };
}
