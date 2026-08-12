import { Pressable, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { CloseIcon, SearchIcon } from './icons';

export type SearchFieldProps = {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
};

export function SearchField({
  value,
  onChangeText,
  placeholder,
  onSubmit,
  autoFocus,
}: SearchFieldProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        backgroundColor: theme.colors.bg.subtle,
        borderRadius: theme.radii.md,
        paddingHorizontal: theme.spacing.md,
        height: theme.minTouchTarget,
      }}
    >
      <SearchIcon color={theme.colors.text.tertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? t('common.search')}
        placeholderTextColor={theme.colors.text.tertiary}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        accessibilityLabel={placeholder ?? t('common.search')}
        // 'auto' so a Hebrew query aligns right and an English one left, in the
        // same field.
        style={{
          flex: 1,
          color: theme.colors.text.primary,
          fontSize: theme.typography.body.fontSize,
          textAlign: 'auto',
        }}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.clear')}
          onPress={() => onChangeText('')}
          hitSlop={12}
        >
          <CloseIcon size={18} color={theme.colors.text.tertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}
