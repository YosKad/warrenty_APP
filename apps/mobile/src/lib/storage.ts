import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Two storage tiers, deliberately separated.
 *
 * `getItem`/`setItem` — non-sensitive preferences (theme, locale, onboarding seen).
 * `secureGet`/`secureSet` — anything that grants access: auth tokens above all.
 *   Backed by the iOS Keychain and the Android Keystore, never by AsyncStorage.
 *
 * SecureStore rejects values over ~2KB on some platforms, so the Supabase session
 * (which can exceed that once the JWT carries claims) is chunked across keys.
 */

const SECURE_CHUNK_SIZE = 1800;
const CHUNK_COUNT_SUFFIX = '__chunks';

export async function getItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Preference persistence is best-effort; losing it must never break the app.
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* best-effort */
  }
}

export async function secureGet(key: string): Promise<string | null> {
  const countRaw = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  if (!countRaw) {
    return SecureStore.getItemAsync(key);
  }
  const count = Number.parseInt(countRaw, 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const part = await SecureStore.getItemAsync(`${key}__${i}`);
    // A missing chunk means the value is corrupt; treat it as absent rather than
    // handing back a truncated token.
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join('');
}

export async function secureSet(key: string, value: string): Promise<void> {
  await secureRemove(key);
  if (value.length <= SECURE_CHUNK_SIZE) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += SECURE_CHUNK_SIZE) {
    chunks.push(value.slice(i, i + SECURE_CHUNK_SIZE));
  }
  for (let i = 0; i < chunks.length; i += 1) {
    await SecureStore.setItemAsync(`${key}__${i}`, chunks[i] as string);
  }
  await SecureStore.setItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`, String(chunks.length));
}

export async function secureRemove(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  if (countRaw) {
    const count = Number.parseInt(countRaw, 10);
    for (let i = 0; i < count; i += 1) {
      await SecureStore.deleteItemAsync(`${key}__${i}`);
    }
    await SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  }
  await SecureStore.deleteItemAsync(key);
}

/** Storage adapter shaped for `@supabase/supabase-js`. */
export const secureSessionStorage = {
  getItem: secureGet,
  setItem: secureSet,
  removeItem: secureRemove,
};
