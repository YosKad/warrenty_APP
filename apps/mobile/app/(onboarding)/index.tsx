import { useRef, useState } from 'react';
import {
  Pressable,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';
import { setItem } from '@/lib/storage';
import { track } from '@/lib/analytics';
import { Button, Text, WarrantyMarkIcon } from '@/ui';
import { ONBOARDING_KEY } from '../index';

/**
 * Onboarding.
 *
 * Three benefit slides and a call to action. Benefits, not features: nobody signs up
 * because an app has OCR, they sign up because they stop losing money on repairs
 * that were covered.
 *
 * No permission is requested here. Camera and notifications are asked for later, at
 * the moment they are obviously needed — which is both better UX and materially
 * better grant rates.
 */

const SLIDE_KEYS = ['slide1', 'slide2', 'slide3', 'slide4'] as const;

export default function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const isLast = index === SLIDE_KEYS.length - 1;

  const finish = async (skipped: boolean) => {
    await setItem(ONBOARDING_KEY, 'true');
    track({ name: 'onboarding_completed', props: { skipped } });
    router.replace('/(auth)/welcome');
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.bg.brand,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + theme.spacing.lg,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          paddingHorizontal: theme.spacing.lg,
          height: 44,
        }}
      >
        {!isLast ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void finish(true)}
            hitSlop={12}
            style={{ justifyContent: 'center' }}
          >
            <Text variant="bodySmallStrong" tone="onBrand" style={{ opacity: 0.7 }}>
              {t('common.skip')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={{ flex: 1 }}
      >
        {SLIDE_KEYS.map((key) => (
          <View
            key={key}
            style={{
              width,
              paddingHorizontal: theme.spacing.xl,
              justifyContent: 'center',
              gap: theme.spacing.lg,
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: theme.radii.xl,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.08)',
              }}
            >
              <WarrantyMarkIcon size={32} color={theme.colors.text.onBrand} />
            </View>
            <Text variant="display" tone="onBrand">
              {t(`onboarding.${key}.title`)}
            </Text>
            <Text
              variant="body"
              tone="onBrand"
              style={{ opacity: 0.75, maxWidth: 340 }}
            >
              {t(`onboarding.${key}.body`)}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.lg }}>
        <Pager count={SLIDE_KEYS.length} index={index} />
        <Button
          label={isLast ? t('onboarding.slide4.cta') : t('common.next')}
          fullWidth
          onPress={() => {
            if (isLast) {
              void finish(false);
              return;
            }
            scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
            setIndex(index + 1);
          }}
        />
      </View>
    </View>
  );
}

function Pager({ count, index }: { count: number; index: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      style={{ flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'center' }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            width: i === index ? 20 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor:
              i === index ? theme.colors.text.onBrand : 'rgba(255,255,255,0.3)',
          }}
        />
      ))}
    </View>
  );
}
