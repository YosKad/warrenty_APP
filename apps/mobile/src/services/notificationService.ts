import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { Database, NotificationKindDb } from '@/types/database';

/**
 * Notifications.
 *
 * Reminders are scheduled and sent server-side (pg_cron → send-reminders Edge
 * Function → APNs/FCM). Local scheduling alone would lose every reminder when the
 * user reinstalls or switches phones — unacceptable for a product whose promise is
 * "never miss a warranty".
 *
 * The device's only jobs are: register a push token, keep its timezone current, and
 * render the inbox.
 */

export type AlertItem = {
  id: string;
  kind: NotificationKindDb;
  productId: string | null;
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
  scheduledFor: string;
  sentAt: string | null;
  readAt: string | null;
};

type NotificationRow = Database['public']['Tables']['notifications']['Row'];

/**
 * Permission is requested *contextually* — after the user adds their first product,
 * where the value is obvious — never at launch. Asking cold is how apps get denied
 * permanently.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!Device.isDevice) return false;
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function hasPushPermission(): Promise<boolean> {
  const status = await Notifications.getPermissionsAsync();
  return status.granted;
}

export async function registerDevice(params: {
  userId: string;
  appVersion: string;
  locale: string;
  timeZone: string;
}): Promise<void> {
  try {
    if (!Device.isDevice) return;
    if (!(await hasPushPermission())) return;

    const token = await Notifications.getExpoPushTokenAsync();

    const { error } = await supabase.from('user_devices').upsert(
      {
        user_id: params.userId,
        push_token: token.data,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        app_version: params.appVersion,
        locale: params.locale,
        // The scheduler resolves 09:00 local from this, so a user who moves country
        // starts getting reminders at the right hour without touching settings.
        time_zone: params.timeZone,
      },
      { onConflict: 'push_token' },
    );
    if (error) throw error;
  } catch (error) {
    // Failing to register push must never block sign-in.
    logger.warn('push registration failed');
  }
}

export async function unregisterDevice(pushToken: string): Promise<void> {
  await supabase
    .from('user_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('push_token', pushToken);
}

export async function listAlerts(includeRead = true): Promise<AlertItem[]> {
  try {
    let query = supabase
      .from('notifications')
      .select('*')
      .eq('delivery', 'sent')
      .order('sent_at', { ascending: false })
      .limit(100);
    if (!includeRead) query = query.is('read_at', null);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => toAlert(row as NotificationRow));
  } catch (error) {
    throw toAppError(error);
  }
}

export async function getUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('delivery', 'sent')
    .is('read_at', null);
  if (error) throw toAppError(error);
  return count ?? 0;
}

export async function markRead(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', notificationIds);
  if (error) throw toAppError(error);
}

export type NotificationPreferences = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  expiryOffsetsDays: number[];
  preferredHourLocal: number;
  quietHoursStart: number;
  quietHoursEnd: number;
};

export async function getPreferences(): Promise<NotificationPreferences> {
  try {
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('*')
      .single();
    if (error) throw error;
    return {
      pushEnabled: data.push_enabled,
      emailEnabled: data.email_enabled,
      expiryOffsetsDays: data.expiry_offsets_days,
      preferredHourLocal: data.preferred_hour_local,
      quietHoursStart: data.quiet_hours_start,
      quietHoursEnd: data.quiet_hours_end,
    };
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updatePreferences(
  userId: string,
  patch: Partial<NotificationPreferences>,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('user_notification_settings')
      .update({
        ...(patch.pushEnabled !== undefined && { push_enabled: patch.pushEnabled }),
        ...(patch.emailEnabled !== undefined && { email_enabled: patch.emailEnabled }),
        ...(patch.expiryOffsetsDays !== undefined && {
          expiry_offsets_days: patch.expiryOffsetsDays,
        }),
        ...(patch.preferredHourLocal !== undefined && {
          preferred_hour_local: patch.preferredHourLocal,
        }),
        ...(patch.quietHoursStart !== undefined && {
          quiet_hours_start: patch.quietHoursStart,
        }),
        ...(patch.quietHoursEnd !== undefined && { quiet_hours_end: patch.quietHoursEnd }),
      })
      .eq('user_id', userId);
    if (error) throw error;
  } catch (error) {
    throw toAppError(error);
  }
}

/** Foreground presentation. Alerts matter, so they are shown rather than swallowed. */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

function toAlert(row: NotificationRow): AlertItem {
  return {
    id: row.id,
    kind: row.kind,
    productId: row.product_id,
    titleKey: row.title_key,
    bodyKey: row.body_key,
    params: row.params,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    readAt: row.read_at,
  };
}
