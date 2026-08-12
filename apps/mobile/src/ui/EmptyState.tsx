import React from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';

/**
 * Empty state.
 *
 * Every list in the app has one. A blank screen makes a user think something broke;
 * an empty state explains what will appear here and offers the one action that fills
 * it. The illustration slot stays optional — a well-written sentence beats a stock
 * graphic.
 */

export type EmptyStateProps = {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  illustration?: React.ReactNode;
  compact?: boolean;
};

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  illustration,
  compact = false,
}: EmptyStateProps) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityRole="summary"
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: compact ? theme.spacing.xl : theme.spacing.xxxl,
        paddingHorizontal: theme.spacing.lg,
        gap: theme.spacing.md,
      }}
    >
      {illustration ? <View style={{ marginBottom: theme.spacing.sm }}>{illustration}</View> : null}
      <Text variant={compact ? 'h3' : 'h2'} align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="secondary" align="center" style={{ maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          style={{ marginTop: theme.spacing.sm }}
        />
      ) : null}
      {secondaryLabel && onSecondary ? (
        <Button label={secondaryLabel} variant="ghost" size="sm" onPress={onSecondary} />
      ) : null}
    </View>
  );
}
