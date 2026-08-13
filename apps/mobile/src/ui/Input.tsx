import React, { forwardRef, useState } from 'react';
import {
  Pressable,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { Text } from './Text';

/**
 * Text field.
 *
 * The label sits above the field rather than floating inside it: floating labels
 * disappear once filled, which is exactly when someone reviewing OCR-extracted data
 * most needs to know what they are looking at.
 *
 * Errors are announced to screen readers via `accessibilityLiveRegion` and are shown
 * as text, never as a red border alone.
 */

export type InputProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  /** i18n key or resolved string. */
  error?: string;
  hint?: string;
  required?: boolean;
  /** Marks a value that came from OCR or a lookup and deserves a second look. */
  needsReview?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
};

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    error,
    hint,
    required,
    needsReview,
    leading,
    trailing,
    containerStyle,
    onFocus,
    onBlur,
    multiline,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.text.danger
    : focused
      ? theme.colors.border.focus
      : needsReview
        ? theme.colors.protection.endingFg
        : theme.colors.border.subtle;

  return (
    <View style={[{ gap: theme.spacing.xs + 2 }, containerStyle]}>
      {label ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.xs, alignItems: 'center' }}>
          <Text variant="bodySmallStrong" tone="secondary">
            {label}
          </Text>
          {!required ? (
            <Text variant="caption" tone="tertiary">
              {t('common.optional')}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.bg.surface,
          borderWidth: theme.borderWidth.thin,
          borderColor,
          borderRadius: theme.radii.md,
          paddingHorizontal: theme.spacing.md,
          minHeight: multiline ? 96 : theme.minTouchTarget,
          paddingVertical: multiline ? theme.spacing.md : 0,
        }}
      >
        {leading}
        <TextInput
          ref={ref}
          multiline={multiline}
          placeholderTextColor={theme.colors.text.tertiary}
          // Autofill-friendly defaults; individual fields override where relevant.
          autoCapitalize={rest.autoCapitalize ?? 'sentences'}
          autoCorrect={rest.autoCorrect ?? false}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          accessibilityLabel={label}
          accessibilityHint={hint}
          style={{
            flex: 1,
            color: theme.colors.text.primary,
            fontSize: theme.typography.body.fontSize,
            lineHeight: multiline ? theme.typography.body.lineHeight : undefined,
            paddingVertical: multiline ? 0 : theme.spacing.md,
            // `textAlign: 'auto'` follows the script of what's typed, so a Hebrew
            // product name and an English model number each align correctly in the
            // same form.
            textAlign: 'auto',
          }}
          {...rest}
        />
        {trailing}
      </View>

      {error ? (
        <Text
          variant="caption"
          tone="danger"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : needsReview ? (
        <Text variant="caption" style={{ color: theme.colors.protection.endingFg }}>
          {t('scan.checkThis')}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="tertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

/**
 * A field that opens a picker rather than accepting typing (date, category, brand).
 * Shares the visual language of Input so a form doesn't look like two components.
 */
export function PickerField({
  label,
  value,
  placeholder,
  onPress,
  error,
  required,
  needsReview,
  trailing,
}: {
  label: string;
  value?: string;
  placeholder: string;
  onPress: () => void;
  error?: string;
  required?: boolean;
  needsReview?: boolean;
  trailing?: React.ReactNode;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View style={{ gap: theme.spacing.xs + 2 }}>
      <View style={{ flexDirection: 'row', gap: theme.spacing.xs, alignItems: 'center' }}>
        <Text variant="bodySmallStrong" tone="secondary">
          {label}
        </Text>
        {!required ? (
          <Text variant="caption" tone="tertiary">
            {t('common.optional')}
          </Text>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${value ?? placeholder}`}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: theme.minTouchTarget,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radii.md,
          borderWidth: theme.borderWidth.thin,
          borderColor: error
            ? theme.colors.text.danger
            : needsReview
              ? theme.colors.protection.endingFg
              : theme.colors.border.subtle,
          backgroundColor: pressed ? theme.colors.bg.subtle : theme.colors.bg.surface,
        })}
      >
        <Text tone={value ? 'primary' : 'tertiary'} numberOfLines={1} style={{ flex: 1 }}>
          {value ?? placeholder}
        </Text>
        {trailing}
      </Pressable>

      {error ? (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
