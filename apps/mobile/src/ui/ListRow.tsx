import React from 'react';
import { Pressable, Switch, View } from 'react-native';

import { useTheme } from '@/theme';
import { Text } from './Text';
import { ChevronIcon } from './icons';

/**
 * Settings-style list row.
 *
 * One component covers navigation rows, toggle rows and value rows, because a
 * settings screen built from three near-identical components inevitably drifts.
 */

export type ListRowProps = {
  label: string;
  description?: string;
  value?: string;
  leading?: React.ReactNode;
  onPress?: () => void;
  /** Renders a toggle instead of a chevron. */
  toggle?: { value: boolean; onChange: (next: boolean) => void };
  destructive?: boolean;
  disabled?: boolean;
};

export function ListRow({
  label,
  description,
  value,
  leading,
  onPress,
  toggle,
  destructive = false,
  disabled = false,
}: ListRowProps) {
  const theme = useTheme();

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: theme.minTouchTarget + 4,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" tone={destructive ? 'danger' : 'primary'}>
          {label}
        </Text>
        {description ? (
          <Text variant="caption" tone="tertiary">
            {description}
          </Text>
        ) : null}
      </View>

      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          disabled={disabled}
          accessibilityLabel={label}
          trackColor={{
            false: theme.colors.border.default,
            true: theme.colors.accent.solid,
          }}
        />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          {value ? (
            <Text variant="bodySmall" tone="tertiary" numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {onPress ? <ChevronIcon color={theme.colors.text.tertiary} /> : null}
        </View>
      )}
    </View>
  );

  if (!onPress || toggle) {
    return content;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.colors.bg.subtle : 'transparent',
      })}
    >
      {content}
    </Pressable>
  );
}

/** Groups rows into a bordered card with hairline separators between them. */
export function ListGroup({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const items = React.Children.toArray(children);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {title ? (
        <Text
          variant="metadata"
          tone="tertiary"
          accessibilityRole="header"
          style={{ paddingHorizontal: theme.spacing.xs }}
        >
          {title}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: theme.colors.bg.surface,
          borderRadius: theme.radii.lg,
          borderWidth: theme.borderWidth.hairline,
          borderColor: theme.colors.border.subtle,
          overflow: 'hidden',
        }}
      >
        {items.map((child, index) => (
          <View key={index}>
            {index > 0 ? (
              <View
                style={{
                  height: theme.borderWidth.hairline,
                  backgroundColor: theme.colors.border.subtle,
                  // Inset so the separator aligns with the label, not the card edge.
                  marginStart: theme.spacing.lg,
                }}
              />
            ) : null}
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}
