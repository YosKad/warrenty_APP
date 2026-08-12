import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { detectRegion } from '@/i18n';
import { updateProfile } from '@/services/profileService';
import { useSessionStore } from '@/state/session';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { Card, CheckIcon, ListGroup, ListRow, Text, useToast } from '@/ui';

/**
 * Country.
 *
 * Country matters because warranty terms, importers and service networks differ by
 * market — the same TV can carry 24 months in one country and 12 in another.
 *
 * It is set manually, seeded from the device region. The app never asks for location
 * permission to work this out: a country picker is more accurate than a GPS fix, and
 * an app that demands location to store receipts deserves to be deleted.
 */

const COMMON_COUNTRIES = ['IL', 'US', 'GB', 'DE', 'FR', 'ES', 'IT', 'CA', 'AU'] as const;

export default function RegionScreen() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const profile = useSessionStore((s) => s.profile);
  const patchProfile = useSessionStore((s) => s.patchProfile);
  const [saving, setSaving] = useState(false);

  const current = profile?.countryCode ?? detectRegion();

  const displayName = (code: string) => {
    try {
      return (
        new Intl.DisplayNames([i18n.language], { type: 'region' }).of(code) ?? code
      );
    } catch {
      return code;
    }
  };

  const choose = async (countryCode: string) => {
    setSaving(true);
    try {
      await updateProfile({ countryCode });
      patchProfile({ countryCode });
    } catch {
      toast.show(t('errors.unknown'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScreen title={t('profile.country')}>
      <Card variant="subtle">
        <Text variant="bodySmall" tone="secondary">
          {t('warranty.source.internal_db')}
        </Text>
      </Card>

      <ListGroup>
        {COMMON_COUNTRIES.map((code) => (
          <ListRow
            key={code}
            label={displayName(code)}
            value={code}
            disabled={saving}
            onPress={() => void choose(code)}
            leading={current === code ? <CheckIcon size={18} /> : undefined}
          />
        ))}
      </ListGroup>
    </SettingsScreen>
  );
}
