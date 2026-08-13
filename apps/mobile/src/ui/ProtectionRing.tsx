import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/theme';
import { Text } from './Text';

/**
 * Protection Score ring.
 *
 * The one genuinely expressive element on Home. It replaces V1's three numeric
 * tiles, which stated facts ("6 active") without ever implying an action.
 *
 * The number is deterministic — see `src/domain/protection.ts` and the formula
 * in docs/V2_PLAN.md. Nothing about it is inferred, which is why it can be shown
 * this prominently.
 */

export type ProtectionRingProps = {
  /** 0–100, or null for an empty portfolio. */
  score: number | null;
  size?: number;
  band?: 'strong' | 'fair' | 'needs_attention' | 'empty';
  caption?: string;
};

export function ProtectionRing({
  score,
  size = 132,
  band = 'strong',
  caption,
}: ProtectionRingProps) {
  const theme = useTheme();

  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;

  const fill =
    band === 'needs_attention'
      ? theme.colors.protection.endingFg
      : theme.colors.protection.ringFill;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={score === null ? undefined : { min: 0, max: 100, now: score }}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg
        width={size}
        height={size}
        // Start the arc at 12 o'clock rather than 3, which is where a progress
        // ring is read from.
        style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={theme.colors.protection.ringTrack}
          strokeWidth={stroke}
          fill="none"
        />
        {score !== null ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={fill}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference * pct} ${circumference}`}
          />
        ) : null}
      </Svg>

      <View style={{ alignItems: 'center', gap: 1 }}>
        <Text variant="display" style={{ fontVariant: ['tabular-nums'] }}>
          {score === null ? '—' : `${score}%`}
        </Text>
        {caption ? (
          <Text variant="caption" tone="tertiary">
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The compact per-product version, used on product detail. A bar rather than a
 * ring, because at this size a ring is decoration and a bar is information.
 */
export function ProtectionMeter({
  score,
  label,
}: {
  score: number;
  label?: string;
}) {
  const theme = useTheme();
  const tone =
    score >= 85
      ? theme.colors.protection.activeFg
      : score >= 60
        ? theme.colors.protection.endingFg
        : theme.colors.protection.expiredFg;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {label ? (
          <Text variant="metadata" tone="tertiary">
            {label}
          </Text>
        ) : null}
        <Text variant="metadata" style={{ color: tone }}>
          {score}%
        </Text>
      </View>
      <View
        accessibilityElementsHidden
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.colors.protection.ringTrack,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.max(0, Math.min(100, score))}%`,
            height: '100%',
            borderRadius: 3,
            backgroundColor: tone,
          }}
        />
      </View>
    </View>
  );
}
