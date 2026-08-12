import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme';
import { Text } from './Text';

/**
 * Segmented control. Used for mutually exclusive view filters (All / Active /
 * Ending soon / Expired) where the options are few and always visible.
 */

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  /** Count shown alongside the label, e.g. "Active 9". */
  badge?: number;
};

export type SegmentedControlProps<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.bg.subtle,
        borderRadius: theme.radii.md,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={
              option.badge === undefined ? option.label : `${option.label}, ${option.badge}`
            }
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              minHeight: 36,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: theme.spacing.xs,
              borderRadius: theme.radii.sm + 1,
              backgroundColor: selected ? theme.colors.bg.surface : 'transparent',
              ...(selected ? theme.elevation(1) : {}),
            }}
          >
            <Text
              variant="bodySmallStrong"
              tone={selected ? 'primary' : 'secondary'}
              numberOfLines={1}
            >
              {option.label}
            </Text>
            {option.badge !== undefined ? (
              <Text variant="caption" tone={selected ? 'secondary' : 'tertiary'}>
                {option.badge}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
