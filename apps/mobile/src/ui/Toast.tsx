import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';
import { Text } from './Text';
import { CheckIcon, InfoIcon } from './icons';

/**
 * Toast.
 *
 * Confirmation of something that already happened ("Product saved"), never a
 * question and never an error the user must act on — those get a dialog or an inline
 * message. Toasts are announced to screen readers so a blind user isn't the only one
 * who misses the confirmation.
 */

export type ToastTone = 'success' | 'info' | 'error';

type ToastState = { id: number; message: string; tone: ToastTone };

type ToastContextValue = {
  show: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const VISIBLE_MS = 3200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ id: Date.now(), message, tone });
    AccessibilityInfo.announceForAccessibility(message);
    timerRef.current = setTimeout(() => setToast(null), VISIBLE_MS);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} /> : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

function ToastView({ toast }: { toast: ToastState }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(-16);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withTiming(0, { duration: theme.duration.fast });
    opacity.value = withTiming(1, { duration: theme.duration.fast });
  }, [translateY, opacity, theme.duration.fast]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const tone =
    toast.tone === 'error'
      ? { bg: theme.colors.feedback.dangerBg, fg: theme.colors.feedback.dangerFg }
      : toast.tone === 'info'
        ? { bg: theme.colors.feedback.infoBg, fg: theme.colors.feedback.infoFg }
        : { bg: theme.colors.feedback.successBg, fg: theme.colors.feedback.successFg };

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        {
          position: 'absolute',
          top: insets.top + theme.spacing.sm,
          left: theme.spacing.lg,
          right: theme.spacing.lg,
          zIndex: theme.zIndex.toast,
        },
        animatedStyle,
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.bg.surface,
          borderRadius: theme.radii.md,
          borderWidth: theme.borderWidth.hairline,
          borderColor: theme.colors.border.subtle,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          ...theme.elevation(2),
        }}
      >
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tone.bg,
          }}
        >
          {toast.tone === 'success' ? (
            <CheckIcon size={16} color={tone.fg} />
          ) : (
            <InfoIcon size={16} color={tone.fg} />
          )}
        </View>
        <Text variant="bodySmall" style={{ flex: 1 }}>
          {toast.message}
        </Text>
      </View>
    </Animated.View>
  );
}
