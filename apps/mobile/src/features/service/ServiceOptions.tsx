import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import {
  capabilityState,
  type Availability,
  type CapabilityKind,
  type ServiceCapability,
} from '@/domain/serviceConcierge';
import { CheckIcon, CloseIcon, Text } from '@/ui';

/**
 * "Service options".
 *
 * Three states, and the third is the point: a capability we have not confirmed
 * says "availability not confirmed" rather than quietly rendering as a cross.
 * Telling someone a technician cannot come when we simply do not know is how a
 * user ends up carrying a television across town for no reason.
 *
 * Enum names never reach the screen — "home_technician" is a database fact and
 * "a technician can come to your home" is the same fact a person can use.
 */

/** The order a person weighs them in: least effort for them, first. */
const SHOWN: CapabilityKind[] = [
  'home_technician',
  'courier',
  'mail_in',
  'drop_off',
  'phone_diagnostics',
  'remote_support',
  'appointment_required',
];

export type ServiceOptionsProps = {
  capabilities: ServiceCapability[];
};

export function ServiceOptions({ capabilities }: ServiceOptionsProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  const rows = SHOWN.map((kind) => ({ kind, state: capabilityState(capabilities, kind) }))
    // A capability nobody has said anything about at all is omitted, not listed
    // as unknown — seven "not confirmed" rows is noise, not honesty.
    .filter((row) => capabilities.some((c) => matches(c.kind, row.kind)));

  if (rows.length === 0) return null;

  const leadTime = capabilities.find(
    (c) => c.typicalLeadTimeDays !== null && c.availability === 'available',
  );
  const fee = capabilities.find((c) => c.feeNote && c.availability === 'available');

  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <Text variant="h3" accessibilityRole="header">
        {t('service.options')}
      </Text>

      <View style={{ gap: theme.spacing.sm }}>
        {rows.map((row) => (
          <View
            key={row.kind}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}
          >
            <View style={{ marginTop: 1 }}>
              <StateMark state={row.state} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                variant="bodySmall"
                tone={row.state === 'unavailable' ? 'tertiary' : 'primary'}
              >
                {t(`service.capability.${row.kind}`)}
              </Text>
              {row.state === 'unknown' ? (
                <Text variant="caption" tone="tertiary">
                  {t('service.availabilityUnknown')}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {leadTime?.typicalLeadTimeDays !== undefined && leadTime?.typicalLeadTimeDays !== null ? (
        <Text variant="caption" tone="tertiary">
          {t('service.leadTime', { count: leadTime.typicalLeadTimeDays })}
        </Text>
      ) : null}

      {/* Fees are the part providers bury and users care about most. */}
      {fee?.feeNote ? (
        <Text variant="caption" tone="secondary" style={{ writingDirection: 'auto' }}>
          {fee.feeNote}
        </Text>
      ) : null}
    </View>
  );
}

function StateMark({ state }: { state: Availability }) {
  const theme = useTheme();
  if (state === 'available') {
    return <CheckIcon size={16} color={theme.colors.protection.activeFg} />;
  }
  if (state === 'unavailable') {
    return <CloseIcon size={16} color={theme.colors.text.tertiary} />;
  }
  // A hollow ring: neither a tick nor a cross, because it is neither.
  return (
    <View
      style={{
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 1.5,
        borderColor: theme.colors.border.default,
      }}
    />
  );
}

function matches(actual: CapabilityKind, wanted: CapabilityKind): boolean {
  const synonyms: Record<string, string> = {
    home_visit: 'home_technician',
    pickup: 'courier',
    phone_support: 'phone_diagnostics',
    online_support: 'remote_support',
    walk_in: 'drop_off',
  };
  return (synonyms[actual] ?? actual) === (synonyms[wanted] ?? wanted);
}
