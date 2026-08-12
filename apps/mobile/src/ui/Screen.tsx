import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type ScrollViewProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

/**
 * Screen container.
 *
 * Handles the three things every screen needs and no screen should re-implement:
 * safe-area insets, the keyboard, and the canvas colour. Bottom inset is added to
 * the scroll content rather than the container so content scrolls under the home
 * indicator instead of stopping short of it.
 */

export type ScreenProps = {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Extra bottom space for a fixed footer (e.g. a sticky primary action). */
  footerHeight?: number;
  contentContainerStyle?: ViewStyle;
  refreshControl?: ScrollViewProps['refreshControl'];
  edges?: { top?: boolean; bottom?: boolean };
};

export function Screen({
  children,
  scroll = false,
  padded = true,
  footerHeight = 0,
  contentContainerStyle,
  refreshControl,
  edges = { top: true, bottom: true },
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const paddingTop = edges.top === false ? 0 : insets.top;
  const paddingBottom = (edges.bottom === false ? 0 : insets.bottom) + footerHeight;

  const inner: ViewStyle = {
    ...(padded ? { paddingHorizontal: theme.spacing.lg } : {}),
    paddingBottom: paddingBottom + theme.spacing.xl,
  };

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[inner, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, inner, contentContainerStyle]}>{children}</View>
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.bg.canvas,
        paddingTop,
      }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        {body}
      </KeyboardAvoidingView>
    </View>
  );
}

/** Sticky footer for a screen's single primary action. */
export function ScreenFooter({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.md,
        paddingBottom: insets.bottom + theme.spacing.md,
        backgroundColor: theme.colors.bg.canvas,
        borderTopWidth: theme.borderWidth.hairline,
        borderTopColor: theme.colors.border.subtle,
      }}
    >
      {children}
    </View>
  );
}
