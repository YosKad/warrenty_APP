'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { supabaseBrowser } from '@/lib/supabase/client';

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { error: signInError } = await supabaseBrowser().auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // Deliberately generic. Which half was wrong is useful to an attacker and
      // useless to the person typing.
      setError('Those credentials were not accepted.');
      setBusy(false);
      return;
    }

    router.replace(params.get('next') ?? '/');
    router.refresh();
  }

  return (
    <main className="centered">
      <form className="card-narrow stack" onSubmit={onSubmit}>
        <div>
          <h1>Data Operations</h1>
          <p className="topbar-sub">MY Warranty — internal console</p>
        </div>

        <label className="field">
          Email
          <input
            type="email"
            value={email}
            autoComplete="username"
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="field">
          Password
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? (
          <p className="notice" data-tone="danger">
            {error}
          </p>
        ) : null}

        <button type="submit" data-variant="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="panel-note">
          Signing in does not grant access. Administrator membership is granted
          separately and cannot be requested from here.
        </p>
      </form>
    </main>
  );
}
