import { useEffect } from 'react';
import { AccessibilityInfo, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';

/**
 * Skeleton placeholder.
 *
 * Shows the *shape* of what is coming rather than a spinner, which makes the wait
 * feel shorter and stops the layout jumping on arrival. The pulse is disabled when
 * the OS reports "reduce motion" — a looping animation is genuinely uncomfortable
 * for some people, and the static block conveys the same thing.
 */

export type SkeletonProps = {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
};

export function Skeleton({ width = '100%', height = 16, radius, style }: SkeletonProps) {
  const theme = useTheme();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled || reduceMotion) return;
      opacity.value = withRepeat(
        withTiming(1, { duration: theme.duration.slow }),
        -1,
        true,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [opacity, theme.duration.slow]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radii.sm,
          backgroundColor: theme.colors.bg.subtle,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** The loading shape of a product card, matched to ProductCard's real dimensions. */
export function ProductCardSkeleton() {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.lg,
        paddingVertical: theme.spacing.lg,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <Skeleton width={60} height={60} radius={16} />
      <View style={{ flex: 1, gap: theme.spacing.sm }}>
        <Skeleton width="70%" height={16} />
        <Skeleton width="45%" height={12} />
        <Skeleton width={130} height={14} />
      </View>
    </View>
  );
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      {Array.from({ length: count }, (_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </View>
  );
}
