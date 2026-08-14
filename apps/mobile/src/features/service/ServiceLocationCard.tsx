import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { track } from '@/lib/analytics';
import { isolateLtr } from '@/lib/format';
import {
  distanceKm,
  mapUrl,
  openingStatus,
  type Coordinates,
  type MapProvider,
  type ServiceLocation,
} from '@/domain/serviceConcierge';
import { BottomSheet, ChevronIcon, Text } from '@/ui';

/**
 * One service centre.
 *
 * Shows what a person needs to decide whether to go: whether it is open, whether
 * they need an appointment, and how far it is — the last only when the user has
 * chosen to share a position, because this whole feature works without one.
 *
 * Hours resolve in the branch's timezone and stay silent when unknown. Telling
 * someone a place is shut when it is open is worse than telling them to ring
 * ahead.
 */

export type ServiceLocationCardProps = {
  location: ServiceLocation;
  origin: Coordinates | null;
  onReport?: () => void;
};

export function ServiceLocationCard({ location, origin, onReport }: ServiceLocationCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [mapsOpen, setMapsOpen] = useState(false);

  const status = openingStatus(location.openingHours, new Date(), location.timeZone);
  const km = origin ? distanceKm(origin, location) : null;

  const address = [location.addressLine, location.city].filter(Boolean).join(', ');

  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <View style={{ gap: 2 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.spacing.sm,
          }}
        >
          <Text
            variant="bodyStrong"
            numberOfLines={1}
            style={{ flex: 1, writingDirection: 'auto' }}
          >
            {location.name ?? address}
          </Text>
          {km !== null ? (
            <Text variant="caption" tone="tertiary">
              {isolateLtr(`${km < 10 ? km.toFixed(1) : Math.round(km)} km`)}
            </Text>
          ) : null}
        </View>

        {address ? (
          <Text variant="caption" tone="secondary" style={{ writingDirection: 'auto' }}>
            {address}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        <HoursChip status={status} />
        {location.appointmentRequired ? (
          <Chip label={t('service.appointmentRequired')} tone="warning" />
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('service.action.directions')}
          onPress={() => {
            track({ name: 'service_location_viewed', props: { usedCoordinates: origin !== null } });
            setMapsOpen(true);
          }}
          style={({ pressed }) => ({
            flex: 1,
            alignItems: 'center',
            paddingVertical: theme.spacing.md,
            borderRadius: theme.radii.lg,
            backgroundColor: pressed ? theme.colors.bg.subtle : theme.colors.accent.soft,
          })}
        >
          <Text variant="bodySmallStrong" style={{ color: theme.colors.accent.text }}>
            {t('service.action.directions')}
          </Text>
        </Pressable>

        {location.phone ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('service.action.call')}
            onPress={() => void Linking.openURL(`tel:${location.phone}`)}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              paddingVertical: theme.spacing.md,
              borderRadius: theme.radii.lg,
              backgroundColor: pressed ? theme.colors.bg.subtle : theme.colors.bg.subtle,
            })}
          >
            <Text variant="bodySmallStrong">{t('service.action.call')}</Text>
          </Pressable>
        ) : null}
      </View>

      {onReport ? (
        <Pressable accessibilityRole="button" onPress={onReport} hitSlop={8}>
          <Text variant="caption" tone="tertiary">
            {t('service.reportTitle')}
          </Text>
        </Pressable>
      ) : null}

      {/* Which map apps exist is a device fact. Hard-coding one is how an app
          sends an Android user to Apple Maps. */}
      <BottomSheet
        visible={mapsOpen}
        onDismiss={() => setMapsOpen(false)}
        title={t('service.openMaps')}
      >
        <View style={{ gap: theme.spacing.xs, paddingBottom: theme.spacing.lg }}>
          {(['apple', 'google', 'waze'] as MapProvider[]).map((provider) => (
            <Pressable
              key={provider}
              accessibilityRole="button"
              onPress={() => {
                track({ name: 'directions_opened', props: { provider } });
                setMapsOpen(false);
                void Linking.openURL(mapUrl(provider, location));
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radii.md,
                backgroundColor: pressed ? theme.colors.bg.subtle : 'transparent',
              })}
            >
              <Text variant="body">{t(`service.maps.${provider}`)}</Text>
              <ChevronIcon size={16} color={theme.colors.text.tertiary} />
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

function HoursChip({ status }: { status: ReturnType<typeof openingStatus> }) {
  const { t } = useTranslation();

  if (status.state === 'unknown') {
    return <Chip label={t('service.hoursUnknown')} tone="neutral" />;
  }
  if (status.state === 'open') {
    return (
      <Chip
        label={`${t('service.openNow')} · ${t('service.closesAt', {
          time: isolateLtr(status.closesAt),
        })}`}
        tone="success"
      />
    );
  }
  if (status.state === 'closed') {
    return (
      <Chip
        label={t('service.closedOpens', {
          day: t(`service.day.${status.opensDay}`),
          time: isolateLtr(status.opensAt),
        })}
        tone="neutral"
      />
    );
  }
  return <Chip label={t('service.hoursUnknown')} tone="neutral" />;
}

function Chip({ label, tone }: { label: string; tone: 'success' | 'warning' | 'neutral' }) {
  const theme = useTheme();
  const colors =
    tone === 'success'
      ? { fg: theme.colors.protection.activeFg, bg: theme.colors.protection.activeBg }
      : tone === 'warning'
        ? { fg: theme.colors.protection.endingFg, bg: theme.colors.protection.endingBg }
        : { fg: theme.colors.text.secondary, bg: theme.colors.bg.subtle };

  return (
    <View
      style={{
        paddingVertical: 4,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.radii.pill,
        backgroundColor: colors.bg,
      }}
    >
      <Text variant="caption" style={{ color: colors.fg }}>
        {label}
      </Text>
    </View>
  );
}
