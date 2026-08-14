import { Linking, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { track } from '@/lib/analytics';
import { isolateLtr } from '@/lib/format';
import {
  freshness,
  isServiceable,
  mailtoUrl,
  rankContacts,
  toDialable,
  whatsappUrl,
  type ContactMethod,
} from '@/domain/serviceConcierge';
import { Text } from '@/ui';

/**
 * Contact actions.
 *
 * Compact, native-feeling buttons in a row — not five giant equal cards. Five
 * equal cards is a telephone directory, and a directory is precisely what the
 * user was already able to find on Google.
 *
 * A channel appears only if it can actually be opened: there are no dead
 * buttons here, and spare-parts and sales lines never appear at all.
 */

export type ContactActionsProps = {
  contacts: ContactMethod[];
  /** Pre-filled, still editable. Never sent automatically. */
  message: string;
  subject: string;
  onOpened?: (contact: ContactMethod) => void;
  /** Shown under the row so a two-year-old number is not presented as current. */
  showFreshness?: boolean;
};

export function ContactActions({
  contacts,
  message,
  subject,
  onOpened,
  showFreshness = true,
}: ContactActionsProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  const usable = rankContacts(contacts.filter(isServiceable)).filter(canOpen);
  if (usable.length === 0) return null;

  // One row, four at most. The rest live on the provider's own section below;
  // a horizontal scroll of contact chips is a directory wearing a disguise.
  const shown = usable.slice(0, 4);
  const worst = shown.reduce<ReturnType<typeof freshness>>((acc, c) => {
    const state = freshness(c.verifiedAt, c.verification);
    return rank(state) > rank(acc) ? state : acc;
  }, 'recent');

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {shown.map((contact) => (
          <Pressable
            key={contact.id}
            accessibilityRole="button"
            accessibilityLabel={`${t(`service.action.${actionKey(contact)}`)}. ${t(
              `service.purpose.${contact.purpose}`,
            )}`}
            onPress={() => open(contact, message, subject, onOpened)}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              paddingVertical: theme.spacing.md,
              borderRadius: theme.radii.lg,
              backgroundColor: pressed ? theme.colors.bg.subtle : theme.colors.bg.surface,
            })}
          >
            <Text variant="bodySmallStrong" numberOfLines={1}>
              {t(`service.action.${actionKey(contact)}`)}
            </Text>
            <Text variant="caption" tone="tertiary" numberOfLines={1}>
              {t(`service.purpose.${contact.purpose}`)}
            </Text>
          </Pressable>
        ))}
      </View>

      {showFreshness ? (
        <Text variant="caption" tone="tertiary">
          {t(`service.freshness.${worst}`)}
        </Text>
      ) : null}
    </View>
  );
}

/** The value as the user would read it. Latin digits pinned LTR in Hebrew. */
export function contactDisplay(contact: ContactMethod): string {
  if (contact.kind === 'phone' || contact.kind === 'whatsapp' || contact.kind === 'sms') {
    return isolateLtr(contact.value);
  }
  return contact.value;
}

function actionKey(contact: ContactMethod): string {
  return contact.kind === 'phone' ? 'call' : contact.kind;
}

const FRESHNESS_ORDER = ['recent', 'verified', 'unknown', 'recheck', 'stale'];
function rank(state: string): number {
  return FRESHNESS_ORDER.indexOf(state);
}

/** No dead buttons. A channel we cannot open is a channel we do not show. */
function canOpen(contact: ContactMethod): boolean {
  if (contact.kind === 'address') return false;
  return contact.value.trim().length > 0;
}

function open(
  contact: ContactMethod,
  message: string,
  subject: string,
  onOpened?: (contact: ContactMethod) => void,
): void {
  const url = urlFor(contact, message, subject);
  if (!url) return;

  switch (contact.kind) {
    case 'phone':
      track({ name: 'service_call_started', props: { purpose: contact.purpose } });
      break;
    case 'whatsapp':
      track({ name: 'service_whatsapp_opened', props: { purpose: contact.purpose } });
      break;
    case 'email':
      track({ name: 'service_email_started', props: { purpose: contact.purpose } });
      break;
    case 'web_form':
    case 'website':
      track({ name: 'service_form_opened', props: { purpose: contact.purpose } });
      break;
    default:
      break;
  }

  onOpened?.(contact);
  void Linking.openURL(url);
}

export function urlFor(
  contact: ContactMethod,
  message: string,
  subject: string,
): string | null {
  switch (contact.kind) {
    case 'phone':
      return `tel:${toDialable(contact.value, contact.countryCode ?? 'IL')}`;
    case 'sms':
      return `sms:${toDialable(contact.value, contact.countryCode ?? 'IL')}`;
    case 'whatsapp':
      // Pre-filled and editable. WhatsApp cannot be made to send on its own,
      // and it should not be: the user has to see what goes out in their name.
      return whatsappUrl(contact.value, message);
    case 'email':
      return mailtoUrl(contact.value, subject, message);
    case 'web_form':
    case 'website':
    case 'chat':
      return contact.value;
    default:
      return null;
  }
}
