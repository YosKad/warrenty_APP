import { signOut } from '@/lib/actions/session';

/**
 * Where a signed-in non-admin lands.
 *
 * It says nothing about what is behind the door — no queue counts, no
 * organisation names, no hint that a particular role would help. The database
 * would refuse them anyway; this page just declines to be a reconnaissance
 * tool.
 */
export default function NoAccessPage() {
  return (
    <main className="centered">
      <div className="card-narrow stack">
        <h1>Not available</h1>
        <p className="panel-note">
          This account does not have access to the data operations console.
        </p>
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}
