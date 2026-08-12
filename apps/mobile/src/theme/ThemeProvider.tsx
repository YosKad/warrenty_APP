import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme, type ColorSchemeName } from 'react-native';

import { getItem, setItem } from '@/lib/storage';
import { darkColors, lightColors, type SemanticColors } from './semantic';
import {
  borderWidth,
  duration,
  easing,
  minTouchTarget,
  radii,
  spacing,
  typography,
  zIndex,
} from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

export type Theme = {
  scheme: 'light' | 'dark';
  colors: SemanticColors;
  spacing: typeof spacing;
  radii: typeof radii;
  borderWidth: typeof borderWidth;
  typography: typeof typography;
  duration: typeof duration;
  easing: typeof easing;
  zIndex: typeof zIndex;
  minTouchTarget: number;
  /**
   * Cross-platform elevation. iOS gets a soft shadow; Android gets a matched
   * `elevation` because shadow offsets are ignored there.
   */
  elevation: (level: 0 | 1 | 2 | 3) => object;
};

type ThemeContextValue = {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
};

const THEME_PREFERENCE_KEY = 'mw.theme-preference';

const ThemeContext = createContext<ThemeContextValue | null>(null);

function buildTheme(scheme: 'light' | 'dark'): Theme {
  const colors = scheme === 'dark' ? darkColors : lightColors;
  return {
    scheme,
    colors,
    spacing,
    radii,
    borderWidth,
    typography,
    duration,
    easing,
    zIndex,
    minTouchTarget,
    elevation: (level) => {
      if (level === 0) return {};
      const config = {
        1: { radius: 8, offset: 2, opacity: 1, android: 2 },
        2: { radius: 18, offset: 6, opacity: 1, android: 6 },
        3: { radius: 32, offset: 12, opacity: 1, android: 12 },
      }[level];
      return {
        shadowColor: colors.shadow,
        shadowOpacity: config.opacity,
        shadowRadius: config.radius,
        shadowOffset: { width: 0, height: config.offset },
        elevation: config.android,
      };
    },
  };
}

function resolveScheme(
  preference: ThemePreference,
  system: ColorSchemeName,
): 'light' | 'dark' {
  if (preference === 'system') return system === 'dark' ? 'dark' : 'light';
  return preference;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getItem(THEME_PREFERENCE_KEY);
      if (
        !cancelled &&
        (stored === 'light' || stored === 'dark' || stored === 'system')
      ) {
        setPreferenceState(stored);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const scheme = resolveScheme(preference, systemScheme);
    return {
      theme: buildTheme(scheme),
      preference,
      setPreference: (next) => {
        setPreferenceState(next);
        void setItem(THEME_PREFERENCE_KEY, next);
      },
    };
  }, [preference, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx.theme;
}

export function useThemePreference() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemePreference must be used inside <ThemeProvider>');
  return { preference: ctx.preference, setPreference: ctx.setPreference };
}
