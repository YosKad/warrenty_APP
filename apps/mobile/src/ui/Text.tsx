import {
  Text as RNText,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';

import { useTheme } from '@/theme';
import type { TypographyVariant } from '@/theme/tokens';

/**
 * The only text primitive in the app.
 *
 * Screens pick a `variant` and a semantic `tone`; they never set fontSize or color
 * directly. That is what keeps the type scale honest and what makes dark mode work
 * without a single per-screen conditional.
 *
 * Dynamic Type is respected by default (`allowFontScaling`), capped at 1.6× so an
 * extreme accessibility setting stretches layout without breaking it entirely.
 */

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'danger'
  | 'onBrand'
  | 'inherit';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
};

export function Text({
  variant = 'body',
  tone = 'primary',
  align,
  style,
  children,
  maxFontSizeMultiplier = 1.6,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const typeStyle = theme.typography[variant];

  const color =
    tone === 'inherit'
      ? undefined
      : tone === 'onBrand'
        ? theme.colors.text.onBrand
        : tone === 'accent'
          ? theme.colors.text.accent
          : tone === 'danger'
            ? theme.colors.text.danger
            : theme.colors.text[tone];

  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        {
          fontSize: typeStyle.fontSize,
          lineHeight: typeStyle.lineHeight,
          fontWeight: typeStyle.fontWeight as TextStyle['fontWeight'],
          letterSpacing: typeStyle.letterSpacing,
          ...(color ? { color } : {}),
          ...(variant === 'metadata' ? { textTransform: 'uppercase' as const } : {}),
          ...(align ? { textAlign: align } : {}),
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}
