'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { reviewReport } from '@/lib/actions/queues';

export type ReportRow = {
  id: string;
  kind: string;
  note: string | null;
  suggested_value: string | null;
  status: string;
  created_at: string;
  organisation: { id: string; name: string } | null;
  location: { id: string; name: string | null; city: string | null } | null;
  contact: { id: string; kind: string; value: string } | null;
};

const KIND_LABEL: Record<string, string> = {
  wrong_phone: 'Number does not work',
  location_closed: 'Branch has closed',
  wrong_importer: 'Wrong importer',
  service_unavailable: 'Service not offered',
  wrong_address: 'Wrong address',
  wrong_hours: 'Wrong opening hours',
  other: 'Something else',
};

export function ReportQueue({
  reports,
  canReview,
}: {
  reports: ReportRow[];
  canReview: boolean;
}) {
  return (
    <div className="stack">
      {reports.map((report) => (
        <ReportCard key={report.id} report={report} canReview={canReview} />
      ))}
    </div>
  );
}

function ReportCard({ report, canReview }: { report: ReportRow; canReview: boolean }) {
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function act(status: 'accepted' | 'rejected' | 'duplicate') {
    setMessage(null);
    startTransition(async () => {
      const result = await reviewReport(report.id, status, note || undefined);
      setMessage(result.ok ? 'Recorded.' : result.error);
    });
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="row" style={{ gap: 6 }}>
          <span className="chip" data-tone="warn">
            {KIND_LABEL[report.kind] ?? report.kind}
          </span>
          {report.organisation ? (
            <Link href={`/organisations/${report.organisation.id}`}>
              {report.organisation.name}
            </Link>
          ) : (
            <span className="muted">no organisation attached</span>
          )}
        </div>
        <span className="panel-note">
          {new Date(report.created_at).toISOString().slice(0, 10)}
        </span>
      </div>

      <div className="panel-body stack">
        <table className="data">
          <tbody>
            {report.contact ? (
              <tr>
                <td>Record</td>
                <td className="mono" dir="ltr">
                  {report.contact.kind} · {report.contact.value}
                </td>
              </tr>
            ) : null}
            {report.location ? (
              <tr>
                <td>Branch</td>
                <td dir="auto">
                  {report.location.name ?? report.location.city ?? 'unnamed'}
                </td>
              </tr>
            ) : null}
            {report.note ? (
              <tr>
                <td>What they said</td>
                <td dir="auto">{report.note}</td>
              </tr>
            ) : null}
            {report.suggested_value ? (
              <tr>
                <td>What they suggested</td>
                <td dir="auto">
                  <span className="mono">{report.suggested_value}</span>
                  {/* Shown, never applied. A user's suggestion is a lead, not a fact. */}
                  <span className="chip" style={{ marginInlineStart: 6 }}>
                    unverified
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <label className="field">
          What you did about it
          <input
            type="text"
            value={note}
            disabled={!canReview || pending}
            placeholder="e.g. rang it — dead. Replaced with the number on their contact page."
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <div className="row">
          <button
            type="button"
            data-variant="primary"
            disabled={!canReview || pending}
            onClick={() => act('accepted')}
          >
            Acted on it
          </button>
          <button type="button" disabled={!canReview || pending} onClick={() => act('rejected')}>
            Checked — data is right
          </button>
          <button type="button" disabled={!canReview || pending} onClick={() => act('duplicate')}>
            Already reported
          </button>
          {report.organisation ? (
            <Link className="button" href={`/organisations/${report.organisation.id}`}>
              Open the provider
            </Link>
          ) : null}
        </div>

        {message ? <p className="notice">{message}</p> : null}
      </div>
    </section>
  );
}
