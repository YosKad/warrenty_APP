import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { track } from '@/lib/analytics';
import { useSessionStore } from '@/state/session';
import { reportServiceData } from '@/services/serviceConciergeService';
import { BottomSheet, ChevronIcon, Text, useToast } from '@/ui';

/**
 * "Report a problem with this information".
 *
 * The user knows things we do not — that a number is dead, that a branch closed
 * last year. This is how that reaches us.
 *
 * It writes to a queue, never to the shared record. One person reporting a
 * number as wrong must not remove it for everybody, because making the right
 * number disappear is the cheapest attack on an app like this one. The sheet
 * says so, in a sentence, so a user who reports something and sees no immediate
 * change understands that as review rather than as being ignored.
 */

const KINDS = [
  'wrong_phone',
  'location_closed',
  'wrong_importer',
  'service_unavailable',
  'wrong_address',
  'wrong_hours',
  'other',
] as const;

export type ReportDataSheetProps = {
  visible: boolean;
  productId: string;
  organisationId?: string;
  serviceLocationId?: string;
  contactMethodId?: string;
  onDismiss: () => void;
};

export function ReportDataSheet({
  visible,
  productId,
  organisationId,
  serviceLocationId,
  contactMethodId,
  onDismiss,
}: ReportDataSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const userId = useSessionStore((s) => s.session?.user.id);
  const [pending, setPending] = useState<string | null>(null);

  const report = useMutation({
    mutationFn: async (kind: (typeof KINDS)[number]) => {
      if (!userId) throw new Error('not signed in');
      await reportServiceData({
        reporterId: userId,
        kind,
        productId,
        organisationId: organisationId ?? null,
        serviceLocationId: serviceLocationId ?? null,
        contactMethodId: contactMethodId ?? null,
      });
      return kind;
    },
    onSuccess: (kind) => {
      track({ name: 'service_data_reported', props: { kind } });
      toast.show(t('service.reportSent'));
      onDismiss();
    },
    onError: () => toast.show(t('errors.unknown'), 'error'),
    onSettled: () => setPending(null),
  });

  if (!visible) return null;

  return (
    <BottomSheet visible onDismiss={onDismiss} title={t('service.reportTitle')}>
      <View style={{ gap: theme.spacing.xs, paddingBottom: theme.spacing.lg }}>
        {KINDS.map((kind) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            accessibilityState={{ busy: pending === kind }}
            disabled={report.isPending}
            onPress={() => {
              setPending(kind);
              report.mutate(kind);
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor: pressed ? theme.colors.bg.subtle : 'transparent',
              opacity: report.isPending && pending !== kind ? 0.5 : 1,
            })}
          >
            <Text variant="body">{t(`service.report.${kind}`)}</Text>
            <ChevronIcon size={16} color={theme.colors.text.tertiary} />
          </Pressable>
        ))}

        <Text variant="caption" tone="tertiary" style={{ marginTop: theme.spacing.sm }}>
          {t('service.reportNote')}
        </Text>
      </View>
    </BottomSheet>
  );
}
