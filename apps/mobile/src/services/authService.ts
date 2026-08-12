import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { Session, User } from '@supabase/supabase-js';

import { AppError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

/**
 * Authentication.
 *
 * Supabase Auth (GoTrue) owns credentials; passwords are hashed with bcrypt on the
 * server and never reach our schema. Sessions are persisted in the Keychain /
 * Keystore (see lib/storage) and refreshed while the app is foregrounded.
 *
 * Providers are added by extending `SocialProvider` and the switch in
 * `signInWithProvider` — phone and passkeys slot in without touching call sites.
 */

export type SocialProvider = 'apple' | 'google';

export type AuthResult = { session: Session; user: User };

const EMAIL_REDIRECT = AuthSession.makeRedirectUri({ path: 'auth/callback' });

export async function signUpWithEmail(params: {
  email: string;
  password: string;
  displayName?: string;
  countryCode?: string;
  preferredLanguage?: string;
}): Promise<{ needsEmailConfirmation: boolean }> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email: params.email.trim().toLowerCase(),
      password: params.password,
      options: {
        emailRedirectTo: EMAIL_REDIRECT,
        // Consumed by handle_new_user() to provision the profile in one transaction.
        data: {
          full_name: params.displayName,
          country_code: params.countryCode,
          preferred_language: params.preferredLanguage,
        },
      },
    });
    if (error) throw error;
    // Supabase returns a user with no session when confirmation is required.
    return { needsEmailConfirmation: data.session === null };
  } catch (error) {
    throw toAppError(error);
  }
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthResult> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;
    if (!data.session || !data.user) throw new AppError('unauthenticated');
    return { session: data.session, user: data.user };
  } catch (error) {
    throw toAppError(error);
  }
}

export async function sendPasswordReset(email: string): Promise<void> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: AuthSession.makeRedirectUri({ path: 'auth/reset' }) },
    );
    if (error) throw error;
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updatePassword(newPassword: string): Promise<void> {
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  } catch (error) {
    throw toAppError(error);
  }
}

export async function signInWithProvider(
  provider: SocialProvider,
): Promise<AuthResult> {
  if (provider === 'apple') return signInWithApple();
  return signInWithGoogle();
}

/**
 * Sign in with Apple.
 *
 * Apple returns an identity token which Supabase verifies against Apple's public
 * keys — the app never handles a credential itself. The raw nonce is sent to Apple
 * hashed and to Supabase in the clear, which is what binds the token to this
 * request and defeats replay.
 *
 * Apple only ever supplies the user's name on the *first* authorisation, so it is
 * captured here and written to the profile immediately.
 */
async function signInWithApple(): Promise<AuthResult> {
  if (Platform.OS !== 'ios') {
    throw new AppError('validation', { messageKey: 'auth.appleUnavailable' });
  }
  try {
    const rawNonce = generateNonce();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) throw new AppError('unauthenticated');

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) throw error;
    if (!data.session || !data.user) throw new AppError('unauthenticated');

    const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName.length > 0) {
      await supabase
        .from('user_profiles')
        .update({ display_name: fullName })
        .eq('id', data.user.id);
    }

    return { session: data.session, user: data.user };
  } catch (error) {
    if (isUserCancellation(error)) {
      throw new AppError('validation', { messageKey: 'auth.cancelled' });
    }
    throw toAppError(error);
  }
}

/**
 * Sign in with Google via the system browser.
 *
 * PKCE + an ASWebAuthenticationSession / Custom Tab, never an embedded WebView —
 * Google blocks embedded WebViews, and they would let the app observe credentials.
 */
async function signInWithGoogle(): Promise<AuthResult> {
  try {
    const redirectTo = AuthSession.makeRedirectUri({ path: 'auth/callback' });
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data.url) throw new AppError('server');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') {
      throw new AppError('validation', { messageKey: 'auth.cancelled' });
    }

    const code = new URL(result.url).searchParams.get('code');
    if (!code) throw new AppError('unauthenticated');

    const exchanged = await supabase.auth.exchangeCodeForSession(code);
    if (exchanged.error) throw exchanged.error;
    if (!exchanged.data.session || !exchanged.data.user) {
      throw new AppError('unauthenticated');
    }
    return { session: exchanged.data.session, user: exchanged.data.user };
  } catch (error) {
    throw toAppError(error);
  }
}

export async function signOut(scope: 'local' | 'global' = 'local'): Promise<void> {
  try {
    // 'global' revokes every refresh token for the account — the "log out all
    // devices" control in Settings.
    const { error } = await supabase.auth.signOut({ scope });
    if (error) throw error;
  } catch {
    // A failed sign-out must still clear local state, or the user is stuck.
    logger.warn('signOut failed; clearing local session anyway');
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Account deletion.
 *
 * Deleting an auth user requires the service-role key, so it runs in an Edge
 * Function that also purges Storage objects and writes an audit record. Doing it
 * client-side is impossible by design — and that is the point.
 */
export async function deleteAccount(confirmationEmail: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('delete-account', {
      body: { confirmationEmail: confirmationEmail.trim().toLowerCase() },
    });
    if (error) throw error;
    await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined);
  } catch (error) {
    throw toAppError(error);
  }
}

/** Re-authentication gate before destructive actions such as deletion. */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  return !error;
}

function generateNonce(byteLength = 32): string {
  const bytes = Crypto.getRandomBytes(byteLength);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isUserCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'ERR_REQUEST_CANCELED'
  );
}
