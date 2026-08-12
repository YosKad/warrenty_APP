import { Platform } from 'react-native';

/**
 * Non-colour design tokens: spacing, radii, typography, elevation and motion.
 *
 * Spacing is a strict 8pt system with two half-steps (4 and 12) for dense controls.
 * Anything that needs a value outside this scale is a design bug, not a code one.
 */

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
} as const;

export type SpacingToken = keyof typeof spacing;

export const radii = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

export const borderWidth = {
  hairline: Platform.select({ ios: 0.5, default: 1 }) as number,
  thin: 1,
  thick: 2,
} as const;

/**
 * Type scale. Sizes are in points and pair with lineHeight values chosen for a
 * comfortable 1.25–1.5 ratio depending on role. `letterSpacing` tightens as size
 * grows, which is what makes large text read as designed rather than as scaled-up
 * body copy.
 */
export const typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.8 },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.5 },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '650', letterSpacing: -0.3 },
  h3: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400', letterSpacing: 0 },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: 0 },
  bodySmall: { fontSize: 14, lineHeight: 20, fontWeight: '400', letterSpacing: 0 },
  bodySmallStrong: { fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: 0 },
  button: { fontSize: 16, lineHeight: 20, fontWeight: '600', letterSpacing: -0.1 },
  // Uppercase micro-label for section headers and card metadata.
  metadata: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.6 },
  // Tabular figures for counts, prices and day counters so numbers don't jitter.
  numeric: { fontSize: 28, lineHeight: 32, fontWeight: '700', letterSpacing: -0.6 },
} as const;

export type TypographyVariant = keyof typeof typography;

/**
 * The minimum tappable area required by both Apple's HIG (44pt) and Material
 * (48dp). We standardise on 48 so a control is never marginal on either platform.
 */
export const minTouchTarget = 48;

export const duration = {
  instant: 90,
  fast: 160,
  normal: 240,
  slow: 380,
} as const;

/** Standard easing curve — matches the iOS system feel without importing a library. */
export const easing = {
  standard: [0.2, 0, 0, 1] as const,
  decelerate: [0, 0, 0.2, 1] as const,
  accelerate: [0.4, 0, 1, 1] as const,
};

export const zIndex = {
  base: 0,
  sticky: 10,
  header: 20,
  overlay: 100,
  sheet: 110,
  toast: 200,
} as const;
