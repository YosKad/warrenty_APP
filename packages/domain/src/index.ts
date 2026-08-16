/**
 * `@mw/domain` — the deterministic core shared by the mobile app and the data
 * operations console.
 *
 * Nothing in this package touches a network, a database or a framework. That is
 * what lets the console score a warranty match exactly as the app does, which
 * matters because a reviewer approving data in the console is making a
 * prediction about what a user's phone will show. Two implementations of the
 * same weights is how that prediction stops being true.
 */

export * from './sources';
export * from './match';
export * from './normalise';
export * from './freshness';
export * from './duplicates';
export * from './resolution';
