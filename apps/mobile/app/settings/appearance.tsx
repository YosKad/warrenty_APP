import { useTranslation } from 'react-i18next';

import { useThemePreference, type ThemePreference } from '@/theme';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { CheckIcon, ListGroup, ListRow } from '@/ui';

const OPTIONS: { value: ThemePreference; labelKey: string }[] = [
  { value: 'system', labelKey: 'profile.themeSystem' },
  { value: 'light', labelKey: 'profile.themeLight' },
  { value: 'dark', labelKey: 'profile.themeDark' },
];

export default function AppearanceScreen() {
  const { t } = useTranslation();
  const { preference, setPreference } = useThemePreference();

  return (
    <SettingsScreen title={t('profile.appearance')}>
      <ListGroup>
        {OPTIONS.map((option) => (
          <ListRow
            key={option.value}
            label={t(option.labelKey)}
            onPress={() => setPreference(option.value)}
            leading={preference === option.value ? <CheckIcon size={18} /> : undefined}
          />
        ))}
      </ListGroup>
    </SettingsScreen>
  );
}
