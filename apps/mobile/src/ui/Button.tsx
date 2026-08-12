import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/theme';
import { Text } from './Text';

/**
 * Button.
 *
 * Four variants, and the hierarchy is deliberate: there should be exactly one
 * `primary` button visible on a screen at a time. If a screen seems to need two, the
 * screen has two primary tasks and should be split.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Light haptic on press. Reserved for confirming actions, not navigation. */
  haptic?: boolean;
};

const SIZE_STYLES: Record<ButtonSize, { height: number; paddingH: number }> = {
  sm: { height: 36, paddingH: 14 },
  md: { height: 48, paddingH: 20 },
  lg: { height: 56, paddingH: 24 },
};

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  icon,
  disabled,
  style,
  haptic = false,
  onPress,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const sizing = SIZE_STYLES[size];
  const isDisabled = disabled === true || loading;

  const colorsFor = (pressed: boolean) => {
    if (isDisabled) {
      return {
        background: theme.colors.control.disabledBg,
        foreground: theme.colors.control.disabledFg,
        border: 'transparent',
      };
    }
    switch (variant) {
      case 'primary':
        return {
          background: pressed
            ? theme.colors.control.primaryBgPressed
            : theme.colors.control.primaryBg,
          foreground: theme.colors.control.primaryFg,
          border: 'transparent',
        };
      case 'secondary':
        return {
          background: pressed
            ? theme.colors.control.secondaryBgPressed
            : theme.colors.control.secondaryBg,
          foreground: theme.colors.control.secondaryFg,
          border: 'transparent',
        };
      case 'danger':
        return {
          background: pressed ? theme.colors.feedback.dangerBg : 'transparent',
          foreground: theme.colors.text.danger,
          border: theme.colors.border.subtle,
        };
      case 'ghost':
      default:
        return {
          background: pressed ? theme.colors.bg.subtle : 'transparent',
          foreground: theme.colors.text.accent,
          border: 'transparent',
        };
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={(event) => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(event);
      }}
      style={({ pressed }) => {
        const c = colorsFor(pressed);
        return [
          {
            height: sizing.height,
            paddingHorizontal: sizing.paddingH,
            borderRadius: theme.radii.md,
            backgroundColor: c.background,
            borderWidth: variant === 'danger' ? theme.borderWidth.thin : 0,
            borderColor: c.border,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.sm,
            ...(fullWidth ? { alignSelf: 'stretch' } : {}),
          },
          style,
        ];
      }}
      {...rest}
    >
      {({ pressed }) => {
        const c = colorsFor(pressed);
        return (
          <>
            {loading ? (
              <ActivityIndicator size="small" color={c.foreground} />
            ) : (
              <>
                {icon ? <View>{icon}</View> : null}
                <Text
                  variant="button"
                  tone="inherit"
                  numberOfLines={1}
                  style={{ color: c.foreground }}
                >
                  {label}
                </Text>
              </>
            )}
          </>
        );
      }}
    </Pressable>
  );
}
