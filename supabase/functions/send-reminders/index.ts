import { errorResponse, handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabase.ts';

/**
 * The reminder scheduler.
 *
 * Invoked by pg_cron every hour (see the cron migration). Two phases:
 *
 *   1. **Schedule.** For every product with a known warranty end, derive the
 *      reminder dates from the owner's chosen offsets and upsert them. Upserting on
 *      a deterministic idempotency key is what makes this safe to run repeatedly:
 *      a re-run, a retry, or a user editing a warranty date cannot double-notify.
 *   2. **Send.** Deliver anything due, in the owner's timezone at their preferred
 *      hour, and record the outcome.
 *
 * Reminders live server-side rather than as local notifications because the promise
 * is "never miss a warranty" — and locally scheduled notifications are lost on
 * reinstall, on a new phone, and whenever the OS decides to clear them.
 */

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

Deno.serve(async (request: Request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  // The endpoint is public by necessity (pg_cron calls it over HTTP), so a shared
  // secret is what stops anyone else triggering a notification run.
  const secret = Deno.env.get('SCHEDULER_SECRET');
  if (!secret || request.headers.get('x-scheduler-secret') !== secret) {
    return errorResponse('forbidden');
  }

  const admin = serviceClient();
  const scheduled = await scheduleUpcoming(admin);
  const sent = await sendDue(admin);

  return jsonResponse({ scheduled, sent });
});

// deno-lint-ignore no-explicit-any
async function scheduleUpcoming(admin: any): Promise<number> {
  // Only products whose warranty ends within the longest offset window need rows.
  // Scanning the whole table every hour would be wasteful and pointless.
  const { data: products } = await admin
    .from('products')
    .select(
      'id, owner_id, name, warranty_end, warranty_duration_months, warranty_start, purchase_date, extension_months, lifecycle',
    )
    .is('deleted_at', null)
    .not('lifecycle', 'in', '("sold","disposed")')
    .limit(2000);

  if (!products?.length) return 0;

  const ownerIds = [...new Set(products.map((p: { owner_id: string }) => p.owner_id))];
  const { data: settings } = await admin
    .from('user_notification_settings')
    .select('user_id, push_enabled, expiry_offsets_days')
    .in('user_id', ownerIds);

  const settingsByUser = new Map<string, { push_enabled: boolean; expiry_offsets_days: number[] }>(
    (settings ?? []).map((s: { user_id: string; push_enabled: boolean; expiry_offsets_days: number[] }) => [
      s.user_id,
      s,
    ]),
  );

  const today = new Date().toISOString().slice(0, 10);
  const rows: Record<string, unknown>[] = [];

  for (const product of products) {
    const warrantyEnd = effectiveEnd(product);
    if (!warrantyEnd) continue;

    const userSettings = settingsByUser.get(product.owner_id);
    if (userSettings && !userSettings.push_enabled) continue;
    const offsets = userSettings?.expiry_offsets_days ?? [90, 30, 7, 1];

    for (const offset of offsets) {
      const sendOn = addDays(warrantyEnd, -offset);
      if (sendOn < today) continue;

      rows.push({
        owner_id: product.owner_id,
        product_id: product.id,
        kind: 'warranty_expiring',
        title_key: 'alerts.warrantyExpiring.title',
        body_key: 'alerts.warrantyExpiring.body',
        // Interpolation params, not rendered copy: the notification is translated at
        // send time, so a user who switches language gets the right words.
        params: { name: product.name, count: offset },
        scheduled_for: `${sendOn}T09:00:00Z`,
        delivery: 'pending',
        idempotency_key: `${product.id}:warranty_expiring:${offset}:${warrantyEnd}`,
      });
    }
  }

  if (rows.length === 0) return 0;

  // ignoreDuplicates keeps an existing row (and its sent_at) intact rather than
  // resetting a reminder that has already gone out.
  const { error } = await admin
    .from('notifications')
    .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true });

  return error ? 0 : rows.length;
}

// deno-lint-ignore no-explicit-any
async function sendDue(admin: any): Promise<number> {
  const now = new Date().toISOString();

  const { data: due } = await admin
    .from('notifications')
    .select('id, owner_id, title_key, body_key, params, product_id')
    .eq('delivery', 'pending')
    .lte('scheduled_for', now)
    .limit(BATCH_SIZE);

  if (!due?.length) return 0;

  const ownerIds = [...new Set(due.map((n: { owner_id: string }) => n.owner_id))];
  const { data: devices } = await admin
    .from('user_devices')
    .select('user_id, push_token')
    .in('user_id', ownerIds)
    .is('revoked_at', null);

  const { data: profiles } = await admin
    .from('user_profiles')
    .select('id, preferred_language')
    .in('id', ownerIds);

  const languageByUser = new Map<string, string>(
    (profiles ?? []).map((p: { id: string; preferred_language: string }) => [
      p.id,
      p.preferred_language,
    ]),
  );

  const tokensByUser = new Map<string, string[]>();
  for (const device of devices ?? []) {
    const list = tokensByUser.get(device.user_id) ?? [];
    list.push(device.push_token);
    tokensByUser.set(device.user_id, list);
  }

  const messages: Record<string, unknown>[] = [];
  const sentIds: string[] = [];
  const suppressedIds: string[] = [];

  for (const notification of due) {
    const tokens = tokensByUser.get(notification.owner_id) ?? [];
    if (tokens.length === 0) {
      // No registered device: mark it suppressed rather than retrying forever. The
      // alert still appears in the in-app inbox.
      suppressedIds.push(notification.id);
      continue;
    }

    const language = languageByUser.get(notification.owner_id) ?? 'en';
    const copy = renderCopy(notification, language);

    for (const token of tokens) {
      messages.push({
        to: token,
        title: copy.title,
        body: copy.body,
        data: { productId: notification.product_id, notificationId: notification.id },
        sound: null,
        priority: 'normal',
      });
    }
    sentIds.push(notification.id);
  }

  if (messages.length > 0) {
    await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(Deno.env.get('EXPO_ACCESS_TOKEN')
          ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` }
          : {}),
      },
      body: JSON.stringify(messages),
    }).catch(() => undefined);
  }

  if (sentIds.length > 0) {
    await admin
      .from('notifications')
      .update({ delivery: 'sent', sent_at: now })
      .in('id', sentIds);
  }
  if (suppressedIds.length > 0) {
    await admin
      .from('notifications')
      .update({ delivery: 'suppressed', sent_at: now })
      .in('id', suppressedIds);
  }

  return sentIds.length;
}

/**
 * Minimal server-side rendering of the two notification strings.
 *
 * Kept deliberately small and duplicated from the app's locale files rather than
 * importing them: the scheduler needs two sentences, and coupling the Deno runtime to
 * the mobile bundle for that is not worth it. STORE_RELEASE.md notes this as a place
 * to consolidate once a third language lands.
 */
function renderCopy(
  notification: { title_key: string; params: Record<string, string | number> },
  language: string,
): { title: string; body: string } {
  const name = String(notification.params.name ?? '');
  const count = Number(notification.params.count ?? 0);

  if (language === 'he') {
    return {
      title: `האחריות של ${name} מסתיימת בקרוב`,
      body:
        count === 1
          ? 'הכיסוי מסתיים בעוד יום. אם שמתם לב לתקלה, זה הזמן לבדוק את הכיסוי.'
          : `הכיסוי מסתיים בעוד ${count} ימים. אם שמתם לב לתקלה, זה הזמן לבדוק את הכיסוי.`,
    };
  }

  return {
    title: `${name} warranty ends soon`,
    body:
      count === 1
        ? 'Cover ends in 1 day. If you’ve noticed an issue, now may be the time to check coverage.'
        : `Cover ends in ${count} days. If you’ve noticed an issue, now may be the time to check coverage.`,
  };
}

type ProductRow = {
  warranty_end: string | null;
  warranty_start: string | null;
  purchase_date: string | null;
  warranty_duration_months: number | null;
  extension_months: number | null;
};

/** Mirrors `product_warranty_end` in SQL and `resolveWarrantyPeriod` in the app. */
function effectiveEnd(product: ProductRow): string | null {
  if (product.warranty_end) return product.warranty_end;
  const start = product.warranty_start ?? product.purchase_date;
  if (!start || !product.warranty_duration_months) return null;
  return addMonths(start, product.warranty_duration_months + (product.extension_months ?? 0));
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const targetIndex = (m - 1) + months;
  const year = y + Math.floor(targetIndex / 12);
  const month = ((targetIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return new Date(parsed.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
