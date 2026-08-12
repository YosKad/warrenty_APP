import { Redirect } from 'expo-router';

/**
 * Placeholder route for the centre tab.
 *
 * The tab bar intercepts the press and pushes the `/add` modal, so this is only
 * reached by a deep link. Redirecting keeps that case working rather than showing a
 * blank tab.
 */
export default function AddTabPlaceholder() {
  return <Redirect href="/add" />;
}
