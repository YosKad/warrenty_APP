import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { isolateAuto } from '@/lib/format';
import {
  capabilityState,
  type ChainNode,
  type ServiceCapability,
} from '@/domain/serviceConcierge';
import { CheckIcon, ChevronIcon, Text } from '@/ui';

/**
 * The service preview on Product Detail.
 *
 * Enough to answer "is there anything behind this button?" before the user taps
 * it: who honours the warranty, who repairs it, and the one capability that most
 * changes what a repair costs them in effort.
 *
 * Deliberately small. The full concierge is a screen; this is a promise that the
 * screen has something on it.
 */

export type ServicePreviewProps = {
  warrantyHolder: ChainNode | null;
  repairer: ChainNode | null;
  capabilities: ServiceCapability[];
  onPress: () => void;
};

export function ServicePreview({
  warrantyHolder,
  repairer,
  capabilities,
  onPress,
}: ServicePreviewProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (!warrantyHolder && !repairer) return null;

  // One line, chosen by how much it changes the user's day. A technician coming
  // to them is the fact worth surfacing first.
  const highlight = (['home_technician', 'courier', 'drop_off'] as const).find(
    (kind) => capabilityState(capabilities, kind) === 'available',
  );

  const sameCompany =
    warrantyHolder && repairer && warrantyHolder.organisationId === repairer.organisationId;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('service.title')}. ${repairer?.name ?? warrantyHolder?.name ?? ''}`}
      onPress={onPress}
      style={({ pressed }) => ({
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: pressed ? theme.colors.bg.subtle : theme.colors.bg.surface,
      })}
    >
      <Text variant="metadata" tone="tertiary">
        {t('service.previewTitle').toUpperCase()}
      </Text>

      <View style={{ gap: theme.spacing.sm }}>
        {warrantyHolder ? (
          <PreviewRow
            name={warrantyHolder.name}
            role={t('service.roleLabel.warranty_provider')}
          />
        ) : null}
        {/* One company doing both is one row. Repeating the name is what makes a
            three-company chain look like a bureaucracy. */}
        {repairer && !sameCompany ? (
          <PreviewRow name={repairer.name} role={t('service.previewRepairs')} />
        ) : null}
      </View>

      {highlight ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <CheckIcon size={14} color={theme.colors.protection.activeFg} />
          <Text variant="caption" style={{ color: theme.colors.protection.activeFg }}>
            {t(`service.capability.${highlight}`)}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: theme.spacing.xs,
        }}
      >
        <Text variant="bodySmallStrong" tone="accent">
          {t('service.title')}
        </Text>
        <ChevronIcon size={16} color={theme.colors.text.accent} />
      </View>
    </Pressable>
  );
}

function PreviewRow({ name, role }: { name: string; role: string }) {
  return (
    <View style={{ gap: 1 }}>
      <Text variant="caption" tone="tertiary">
        {role}
      </Text>
      <Text variant="bodySmallStrong" numberOfLines={1}>
        {isolateAuto(name)}
      </Text>
    </View>
  );
}
