import { useState } from 'react';
import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { track } from '@/lib/analytics';
import { requestDataExport } from '@/services/profileService';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { Button, Card, Text, useToast } from '@/ui';

/**
 * Data export.
 *
 * Available on every plan. A user's own products, warranties and receipts are not a
 * premium feature, and being able to walk away with your data intact is part of what
 * makes it reasonable to put it here in the first place.
 */
export default function ExportScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const { downloadUrl } = await requestDataExport();
      track({ name: 'export_requested', props: {} });
      await Linking.openURL(downloadUrl);
    } catch {
      toast.show(t('errors.unknown'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsScreen title={t('profile.exportData')} subtitle={t('profile.exportDataBody')}>
      <Card variant="subtle">
        <Text variant="bodySmall" tone="secondary">
          {t('documents.title')} · {t('products.title')} · {t('claim.title')}
        </Text>
      </Card>

      <Button
        label={t('profile.exportData')}
        fullWidth
        loading={busy}
        onPress={() => void onExport()}
      />
    </SettingsScreen>
  );
}
