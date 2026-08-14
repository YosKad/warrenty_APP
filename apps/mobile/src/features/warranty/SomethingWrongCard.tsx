import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { Text } from '@/ui';

/**
 * "Something wrong?"
 *
 * Deliberately not a chat box. A chat box invites "what's the weather" and then
 * has to refuse it; this is a single product-specific action with the product's
 * own name attached, and the only thing it does is check a described fault
 * against that product's warranty.
 *
 * The input lives here rather than on the next screen so the first keystroke is
 * one tap from the product, not three.
 */

export type SomethingWrongCardProps = {
  productName: string;
  onSubmit: (description: string) => void;
  /** Set when the plan does not include coverage checks. */
  locked?: boolean;
};

const MIN_DESCRIPTION = 10;

export function SomethingWrongCard({
  productName,
  onSubmit,
  locked = false,
}: SomethingWrongCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

  const ready = value.trim().length >= MIN_DESCRIPTION;

  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="h3" accessibilityRole="header">
          {t('warrantyIntel.somethingWrongTitle')}
        </Text>
        <Text variant="bodySmall" tone="secondary">
          {t('warrantyIntel.somethingWrongBody')}
        </Text>
      </View>

      <TextInput
        accessibilityLabel={t('warrantyIntel.somethingWrongBody')}
        placeholder={t('warrantyIntel.somethingWrongPlaceholder')}
        placeholderTextColor={theme.colors.text.tertiary}
        value={value}
        onChangeText={setValue}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        multiline
        style={{
          minHeight: 76,
          padding: theme.spacing.md,
          borderRadius: theme.radii.md,
          borderWidth: theme.borderWidth.thin,
          borderColor: focused ? theme.colors.border.focus : theme.colors.border.subtle,
          backgroundColor: theme.colors.bg.subtle,
          color: theme.colors.text.primary,
          fontSize: theme.typography.body.fontSize,
          lineHeight: theme.typography.body.lineHeight,
          // The user's own words decide the direction — a Hebrew speaker
          // describing a fault in a product with an English name must not have
          // their sentence flipped.
          writingDirection: 'auto',
          textAlignVertical: 'top',
        }}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
        accessibilityLabel={`${t('warrantyIntel.checkCoverage')}. ${productName}`}
        disabled={!ready}
        onPress={() => onSubmit(value.trim())}
        style={({ pressed }) => ({
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: theme.minTouchTarget,
          borderRadius: theme.radii.md,
          backgroundColor: ready
            ? pressed
              ? theme.colors.control.primaryBgPressed
              : theme.colors.control.primaryBg
            : theme.colors.control.disabledBg,
        })}
      >
        <Text
          variant="button"
          style={{
            color: ready ? theme.colors.control.primaryFg : theme.colors.control.disabledFg,
          }}
        >
          {t('warrantyIntel.checkCoverage')}
        </Text>
      </Pressable>

      {locked ? (
        <Text variant="caption" tone="tertiary" align="center">
          {t('paywall.aiCoverage')}
        </Text>
      ) : null}
    </View>
  );
}
