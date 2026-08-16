'use client';

import { useState, useTransition, type ReactNode } from 'react';

import { createRecord, updateRecord } from '@/lib/actions/records';

export type FieldSpec = {
  name: string;
  label: string;
  type?:
    | 'text'
    | 'number'
    | 'date'
    | 'url'
    | 'textarea'
    | 'select'
    | 'checkbox'
    | 'multiselect';
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
  width?: 'full' | 'half';
};

/**
 * A form over one record.
 *
 * Blank means unknown, and unknown is saved as null rather than as an empty
 * string — the difference between "this provider has no web form" and "nobody
 * has checked whether this provider has a web form" is the difference the whole
 * product rests on, and a form that silently writes `''` destroys it.
 */
export function RecordForm({
  table,
  id,
  fields,
  initial,
  submitLabel = 'Save',
  disabled = false,
  fixed,
  extra,
  onSaved,
}: {
  table: string;
  id?: string;
  fields: FieldSpec[];
  initial?: Record<string, unknown>;
  submitLabel?: string;
  disabled?: boolean;
  /**
   * Values written with the record but never shown as fields — the owning
   * organisation, typically. Not editable because the page was reached through
   * that organisation, and a picker here would let a typo attach a phone number
   * to the wrong company.
   */
  fixed?: Record<string, unknown>;
  extra?: ReactNode;
  onSaved?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean | string[]>>(() => {
    const seed: Record<string, string | boolean | string[]> = {};
    for (const field of fields) {
      const value = initial?.[field.name];
      if (field.type === 'checkbox') seed[field.name] = Boolean(value);
      else if (field.type === 'multiselect') seed[field.name] = Array.isArray(value) ? value : [];
      else seed[field.name] = value === null || value === undefined ? '' : String(value);
    }
    return seed;
  });
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);

    const patch: Record<string, unknown> = { ...fixed };
    for (const field of fields) {
      const raw = values[field.name];
      if (field.type === 'checkbox') {
        patch[field.name] = Boolean(raw);
        continue;
      }
      if (field.type === 'multiselect') {
        // An empty array, not null: "this company has no roles we know of" is a
        // list of length zero, and the column is not nullable.
        patch[field.name] = Array.isArray(raw) ? raw : [];
        continue;
      }
      const text = String(raw ?? '').trim();
      if (text === '') {
        patch[field.name] = null;
        continue;
      }
      patch[field.name] = field.type === 'number' ? Number(text) : text;
    }

    startTransition(async () => {
      const result = id
        ? await updateRecord(table, id, patch, reason || undefined)
        : await createRecord(table, patch, reason || undefined);

      if (result.ok) {
        setMessage({ tone: 'ok', text: 'Saved.' });
        onSaved?.();
      } else {
        setMessage({ tone: 'danger', text: result.error });
      }
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid grid-2">
        {fields.map((field) => (
          <label
            key={field.name}
            className="field"
            style={field.width === 'full' ? { gridColumn: '1 / -1' } : undefined}
          >
            {field.label}
            {field.type === 'textarea' ? (
              <textarea
                value={String(values[field.name] ?? '')}
                placeholder={field.placeholder}
                required={field.required}
                disabled={disabled || pending}
                onChange={(event) =>
                  setValues((v) => ({ ...v, [field.name]: event.target.value }))
                }
              />
            ) : field.type === 'select' ? (
              <select
                value={String(values[field.name] ?? '')}
                required={field.required}
                disabled={disabled || pending}
                onChange={(event) =>
                  setValues((v) => ({ ...v, [field.name]: event.target.value }))
                }
              >
                <option value="">unknown</option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'multiselect' ? (
              <span className="row" style={{ gap: 10, paddingTop: 2 }}>
                {(field.options ?? []).map((option) => {
                  const selected = Array.isArray(values[field.name])
                    ? (values[field.name] as string[])
                    : [];
                  return (
                    <span key={option.value} className="row" style={{ gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={selected.includes(option.value)}
                        disabled={disabled || pending}
                        style={{ width: 'auto' }}
                        onChange={(event) =>
                          setValues((v) => ({
                            ...v,
                            [field.name]: event.target.checked
                              ? [...selected, option.value]
                              : selected.filter((item) => item !== option.value),
                          }))
                        }
                      />
                      <span style={{ fontSize: 12 }}>{option.label}</span>
                    </span>
                  );
                })}
              </span>
            ) : field.type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={Boolean(values[field.name])}
                disabled={disabled || pending}
                style={{ width: 'auto' }}
                onChange={(event) =>
                  setValues((v) => ({ ...v, [field.name]: event.target.checked }))
                }
              />
            ) : (
              <input
                type={field.type ?? 'text'}
                value={String(values[field.name] ?? '')}
                placeholder={field.placeholder}
                required={field.required}
                disabled={disabled || pending}
                onChange={(event) =>
                  setValues((v) => ({ ...v, [field.name]: event.target.value }))
                }
              />
            )}
            {field.hint ? <span className="panel-note">{field.hint}</span> : null}
          </label>
        ))}
      </div>

      {extra}

      <label className="field">
        Reason for this change
        <input
          type="text"
          value={reason}
          placeholder="Recorded in the audit log"
          disabled={disabled || pending}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>

      <div className="row">
        <button type="submit" data-variant="primary" disabled={disabled || pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        {disabled ? <span className="panel-note">Read access.</span> : null}
      </div>

      {message ? (
        <p className="notice" data-tone={message.tone === 'ok' ? 'info' : 'danger'}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
