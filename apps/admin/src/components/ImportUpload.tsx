'use client';

import { useState, useTransition } from 'react';

import { uploadImport } from '@/lib/actions/import';

const TARGETS = [
  { value: 'organisations', label: 'Organisations' },
  { value: 'organisation_relationships', label: 'Relationships (who imports for whom)' },
  { value: 'provider_contacts', label: 'Contact methods' },
  { value: 'service_locations', label: 'Service locations' },
  { value: 'service_capabilities', label: 'Capabilities' },
];

export function ImportUpload() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      // On success the action redirects, so anything returned here is a failure.
      const result = await uploadImport(formData);
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="row">
        <label className="field" style={{ minWidth: 280 }}>
          What does this file contain?
          <select name="target" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {TARGETS.map((target) => (
              <option key={target.value} value={target.value}>
                {target.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field" style={{ minWidth: 280 }}>
          File
          <input type="file" name="file" accept=".csv,.xls,.xlsx" required />
        </label>

        <button type="submit" data-variant="primary" disabled={pending}>
          {pending ? 'Reading…' : 'Read file'}
        </button>
      </div>

      <p className="panel-note">
        The header must be the first row. Column names in Hebrew or English are
        both recognised; anything unrecognised is mapped by hand on the next
        screen.
      </p>

      {error ? (
        <p className="notice" data-tone="danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
