import {
  Pressable,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme';

/**
 * Card — the app's one container primitive.
 *
 * Elevation is used sparingly: `flat` (a hairline border) is the default because a
 * list of eight shadowed cards reads as noise. Shadow is reserved for surfaces that
 * genuinely float above the content, like the warranty card on a product page.
 */

export type CardProps = ViewProps & {
  elevation?: 0 | 1 | 2 | 3;
  padded?: boolean;
  variant?: 'flat' | 'raised' | 'brand' | 'subtle';
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Card({
  elevation = 0,
  padded = true,
  variant = 'flat',
  onPress,
  accessibilityLabel,
  style,
  children,
  ...rest
}: CardProps) {
  const theme = useTheme();

  const background =
    variant === 'brand'
      ? theme.colors.bg.brand
      : variant === 'subtle'
        ? theme.colors.bg.subtle
        : theme.colors.bg.surface;

  const base: ViewStyle = {
    backgroundColor: background,
    borderRadius: theme.radii.lg,
    borderWidth: variant === 'flat' ? theme.borderWidth.hairline : 0,
    borderColor: theme.colors.border.subtle,
    ...(padded ? { padding: theme.spacing.lg } : {}),
    ...theme.elevation(variant === 'raised' ? Math.max(1, elevation) as 1 | 2 | 3 : elevation),
  };

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [
          base,
          // A subtle scale rather than an opacity flash — it reads as a physical
          // press without the card visibly dimming.
          pressed ? { transform: [{ scale: 0.985 }] } : null,
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={[base, style]} {...rest}>
      {children}
    </View>
  );
}
