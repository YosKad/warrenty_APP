import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { applyDirection, setLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';
import { updateProfile } from '@/services/profileService';
import { useSessionStore } from '@/state/session';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { Card, CheckIcon, ListGroup, ListRow, Text } from '@/ui';

const LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  he: 'עברית',
};

/**
 * Language.
 *
 * Switching between an LTR and an RTL language requires a native restart to
 * re-lay-out the app. Rather than force-quitting on the user's behalf, we change the
 * language immediately (so all copy is already correct) and tell them a restart will
 * finish the job.
 */
export default function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const patchProfile = useSessionStore((s) => s.patchProfile);
  const [restartRequired, setRestartRequired] = useState(false);

  const choose = async (language: SupportedLanguage) => {
    await setLanguage(language);
    const result = applyDirection(language);
    setRestartRequired(result.restartRequired);
    patchProfile({ preferredLanguage: language });
    // Persisted so reminders sent from the server arrive in the right language too.
    await updateProfile({ preferredLanguage: language }).catch(() => undefined);
  };

  return (
    <SettingsScreen title={t('profile.language')}>
      <ListGroup>
        {SUPPORTED_LANGUAGES.map((language) => (
          <ListRow
            key={language}
            label={LABELS[language]}
            onPress={() => void choose(language)}
            leading={i18n.language === language ? <CheckIcon size={18} /> : undefined}
          />
        ))}
      </ListGroup>

      {restartRequired ? (
        <Card variant="subtle">
          <Text variant="bodySmall" tone="secondary" accessibilityLiveRegion="polite">
            {t('profile.restartForRtl')}
          </Text>
        </Card>
      ) : null}
    </SettingsScreen>
  );
}
