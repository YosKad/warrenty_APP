import React, { useEffect } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { Text } from './Text';

/**
 * Bottom sheet.
 *
 * Built on the platform Modal rather than a third-party sheet library: the app needs
 * exactly one sheet behaviour, and owning ~120 lines is cheaper than owning a
 * dependency that must track every React Native release.
 *
 * Accessibility: the sheet takes focus, the scrim is a labelled dismiss target, and
 * `accessibilityViewIsModal` stops VoiceOver from wandering into the screen behind.
 */

export type BottomSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  /** Set false for sheets that require an explicit choice (e.g. destructive confirm). */
  dismissOnBackdropPress?: boolean;
  children: React.ReactNode;
  maxHeightRatio?: number;
};

export function BottomSheet({
  visible,
  onDismiss,
  title,
  dismissOnBackdropPress = true,
  children,
  maxHeightRatio = 0.9,
}: BottomSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const translateY = useSharedValue(40);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      const duration = reduceMotion ? 0 : theme.duration.normal;
      translateY.value = withTiming(0, { duration });
      opacity.value = withTiming(1, { duration });
    });
    return () => {
      translateY.value = 40;
      opacity.value = 0;
    };
  }, [visible, translateY, opacity, theme.duration.normal]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('a11y.close')}
          onPress={dismissOnBackdropPress ? onDismiss : undefined}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.colors.bg.scrim,
          }}
        />

        <Animated.View
          accessibilityViewIsModal
          style={[
            {
              backgroundColor: theme.colors.bg.surface,
              borderTopLeftRadius: theme.radii.xxl,
              borderTopRightRadius: theme.radii.xxl,
              paddingTop: theme.spacing.md,
              paddingBottom: insets.bottom + theme.spacing.lg,
              maxHeight: windowHeight * maxHeightRatio,
              ...theme.elevation(3),
            },
            sheetStyle,
          ]}
        >
          {/* Grabber. Decorative — the scrim and the close action carry the semantics. */}
          <View
            accessibilityElementsHidden
            style={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.colors.border.default,
              marginBottom: theme.spacing.md,
            }}
          />

          {title ? (
            <Text
              variant="h3"
              accessibilityRole="header"
              style={{ paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md }}
            >
              {title}
            </Text>
          ) : null}

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: theme.spacing.lg }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
