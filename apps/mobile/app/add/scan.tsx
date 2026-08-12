import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { track } from '@/lib/analytics';
import { useDraftStore } from '@/state/draftProduct';
import { Button, CloseIcon, EmptyState, Screen, Text } from '@/ui';

/**
 * Receipt capture.
 *
 * Camera permission is requested here — at the moment the user chose to scan — and
 * never at launch. The pre-permission screen explains what the camera is for and that
 * nothing leaves the device until they choose to save, which is both true and the
 * single biggest lever on grant rate.
 *
 * The frame overlay is not decoration: a receipt held inside a guide is dramatically
 * easier to OCR than one photographed at an angle from across a table.
 */
export default function ScanReceiptScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);
  const setPendingDocument = useDraftStore((s) => s.setPendingDocumentId);

  const goToReview = (localUri: string, source: 'camera' | 'gallery' | 'file') => {
    track({ name: 'receipt_scanned', props: { source } });
    setPendingDocument(null);
    router.push({ pathname: '/add/review', params: { localUri } });
  };

  const pickFromLibrary = async () => {
    // The system picker returns exactly the asset chosen — no library-wide permission
    // is requested, so the app never gains access to photos the user didn't offer.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsMultipleSelection: false,
    });
    if (!result.canceled && result.assets[0]) {
      goToReview(result.assets[0].uri, 'gallery');
    }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets[0]) {
      goToReview(result.assets[0].uri, 'file');
    }
  };

  const capture = async () => {
    setCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) goToReview(photo.uri, 'camera');
    } finally {
      setCapturing(false);
    }
  };

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <Screen>
        <View style={{ height: 44, justifyContent: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('a11y.close')}
            onPress={() => router.back()}
            hitSlop={12}
          >
            <CloseIcon color={theme.colors.text.primary} />
          </Pressable>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            title={t('scan.permissionTitle')}
            body={t('scan.permissionBody')}
            actionLabel={t('scan.permissionCta')}
            onAction={() => void requestPermission()}
            secondaryLabel={t('scan.gallery')}
            onSecondary={() => void pickFromLibrary()}
          />
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back">
        <View style={{ flex: 1, padding: theme.spacing.lg }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('a11y.close')}
            onPress={() => router.back()}
            hitSlop={12}
            style={{ alignSelf: 'flex-end', marginTop: theme.spacing.xxl }}
          >
            <CloseIcon color="#FFFFFF" />
          </Pressable>

          <View style={{ flex: 1, justifyContent: 'center' }}>
            <View
              accessibilityElementsHidden
              style={{
                aspectRatio: 0.72,
                borderWidth: 2,
                borderColor: 'rgba(255,255,255,0.85)',
                borderRadius: theme.radii.lg,
              }}
            />
            <Text
              variant="bodySmall"
              align="center"
              style={{ color: '#FFFFFF', marginTop: theme.spacing.lg }}
            >
              {t('scan.guide')}
            </Text>
          </View>

          <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xxl }}>
            <Button
              label={t('scan.capture')}
              fullWidth
              loading={capturing}
              haptic
              onPress={() => void capture()}
            />
            <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
              <Button
                label={t('scan.gallery')}
                variant="secondary"
                size="sm"
                style={{ flex: 1 }}
                onPress={() => void pickFromLibrary()}
              />
              <Button
                label={t('scan.file')}
                variant="secondary"
                size="sm"
                style={{ flex: 1 }}
                onPress={() => void pickDocument()}
              />
            </View>
          </View>
        </View>
      </CameraView>
    </View>
  );
}
