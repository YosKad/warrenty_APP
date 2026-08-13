import { palette } from './palette';

/**
 * Semantic colour tokens (V2).
 *
 * Every colour a screen uses is named for its *role*, never its value. The light
 * and dark maps stay structurally identical — the `SemanticColors` type enforces
 * it, so a token added to one theme fails to compile until it exists in both.
 *
 * V2 adds three role groups the V1 palette lacked:
 *   · `bg.elevated`     — the one genuinely lifted surface per screen
 *   · `protection.*`    — protection state as a first-class role, not a status colour
 *   · `intelligence.*`  — reserved for derived/AI content so the colour itself
 *                          signals "this was worked out, not entered by you"
 *
 * Contrast: all `text.*` on their matching `bg.*` meet WCAG AA (4.5:1) at body
 * sizes in both themes; `text.tertiary` is reserved for large or non-essential text.
 */

export type SemanticColors = {
  bg: {
    /** Warm page ground. Never pure white — cards lift off it without a border. */
    canvas: string;
    /** Raised content: cards, list groups. */
    surface: string;
    /** Recessed fills: inputs, tracks, skeletons. */
    subtle: string;
    /** The single most-lifted surface on a screen: sheets, hero panels. */
    elevated: string;
    /** Full-bleed brand surface. */
    brand: string;
    /** Scrim behind modals and bottom sheets. */
    scrim: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    /** Text on `bg.brand` or on a filled accent control. */
    onBrand: string;
    accent: string;
    danger: string;
  };
  border: {
    subtle: string;
    default: string;
    strong: string;
    focus: string;
  };
  accent: {
    solid: string;
    solidPressed: string;
    soft: string;
    text: string;
  };
  /**
   * Protection state. First-class in V2 because it is the product's core idea,
   * not merely one status among several. Never the only signal — always paired
   * with a label and a distinct shape.
   */
  protection: {
    activeFg: string;
    activeBg: string;
    endingFg: string;
    endingBg: string;
    expiredFg: string;
    expiredBg: string;
    unknownFg: string;
    unknownBg: string;
    /** The score ring track and fill. */
    ringTrack: string;
    ringFill: string;
  };
  /** Derived / AI-assisted content. Used sparingly and consistently. */
  intelligence: {
    fg: string;
    bg: string;
    border: string;
  };
  feedback: {
    successFg: string;
    successBg: string;
    warningFg: string;
    warningBg: string;
    dangerFg: string;
    dangerBg: string;
    infoFg: string;
    infoBg: string;
  };
  control: {
    primaryBg: string;
    primaryBgPressed: string;
    primaryFg: string;
    secondaryBg: string;
    secondaryBgPressed: string;
    secondaryFg: string;
    disabledBg: string;
    disabledFg: string;
  };
  shadow: string;
};

export const lightColors: SemanticColors = {
  bg: {
    canvas: palette.sand[50],
    surface: palette.white,
    subtle: palette.sand[100],
    elevated: palette.white,
    brand: palette.ink[800],
    scrim: 'rgba(28, 25, 23, 0.42)',
  },
  text: {
    primary: palette.ink[900],
    secondary: palette.sand[600],
    tertiary: palette.sand[500],
    onBrand: palette.sand[50],
    accent: palette.pine[500],
    danger: palette.coral[500],
  },
  border: {
    subtle: palette.sand[200],
    default: palette.sand[300],
    strong: palette.sand[400],
    focus: palette.pine[500],
  },
  accent: {
    solid: palette.pine[500],
    solidPressed: palette.pine[700],
    soft: palette.pine[50],
    text: palette.pine[500],
  },
  protection: {
    activeFg: palette.pine[600],
    activeBg: palette.pine[100],
    endingFg: palette.amber[500],
    endingBg: palette.amber[100],
    expiredFg: palette.coral[500],
    expiredBg: palette.coral[100],
    unknownFg: palette.sand[600],
    unknownBg: palette.sand[100],
    ringTrack: palette.sand[200],
    ringFill: palette.pine[500],
  },
  intelligence: {
    fg: palette.iris[500],
    bg: palette.iris[100],
    border: palette.iris[300],
  },
  feedback: {
    successFg: palette.pine[600],
    successBg: palette.pine[100],
    warningFg: palette.amber[500],
    warningBg: palette.amber[100],
    dangerFg: palette.coral[500],
    dangerBg: palette.coral[100],
    infoFg: palette.iris[500],
    infoBg: palette.iris[100],
  },
  control: {
    primaryBg: palette.ink[800],
    primaryBgPressed: palette.ink[600],
    primaryFg: palette.sand[50],
    secondaryBg: palette.sand[100],
    secondaryBgPressed: palette.sand[200],
    secondaryFg: palette.ink[900],
    disabledBg: palette.sand[200],
    disabledFg: palette.sand[400],
  },
  // Warm-tinted rather than neutral black, so shadows sit in the same
  // temperature as the surfaces they fall on.
  shadow: 'rgba(60, 46, 34, 0.13)',
};

export const darkColors: SemanticColors = {
  bg: {
    canvas: palette.umber[950],
    surface: palette.umber[900],
    subtle: palette.umber[800],
    elevated: palette.umber[700],
    brand: palette.umber[800],
    scrim: 'rgba(0, 0, 0, 0.62)',
  },
  text: {
    primary: palette.sand[100],
    secondary: palette.sand[400],
    tertiary: palette.sand[500],
    onBrand: palette.sand[100],
    accent: palette.pine[400],
    danger: palette.coral[300],
  },
  border: {
    subtle: palette.umber[700],
    default: palette.umber[600],
    strong: palette.sand[800],
    focus: palette.pine[400],
  },
  accent: {
    solid: palette.pine[400],
    solidPressed: palette.pine[300],
    soft: 'rgba(79, 191, 151, 0.16)',
    text: palette.pine[400],
  },
  protection: {
    activeFg: palette.pine[300],
    activeBg: 'rgba(79, 191, 151, 0.16)',
    endingFg: palette.amber[300],
    endingBg: 'rgba(232, 180, 94, 0.16)',
    expiredFg: palette.coral[300],
    expiredBg: 'rgba(240, 145, 138, 0.16)',
    unknownFg: palette.sand[400],
    unknownBg: 'rgba(188, 175, 163, 0.12)',
    ringTrack: palette.umber[700],
    ringFill: palette.pine[400],
  },
  intelligence: {
    fg: palette.iris[300],
    bg: 'rgba(169, 155, 240, 0.16)',
    border: 'rgba(169, 155, 240, 0.34)',
  },
  feedback: {
    successFg: palette.pine[300],
    successBg: 'rgba(79, 191, 151, 0.16)',
    warningFg: palette.amber[300],
    warningBg: 'rgba(232, 180, 94, 0.16)',
    dangerFg: palette.coral[300],
    dangerBg: 'rgba(240, 145, 138, 0.16)',
    infoFg: palette.iris[300],
    infoBg: 'rgba(169, 155, 240, 0.16)',
  },
  control: {
    primaryBg: palette.sand[100],
    primaryBgPressed: palette.sand[300],
    primaryFg: palette.ink[950],
    secondaryBg: palette.umber[800],
    secondaryBgPressed: palette.umber[700],
    secondaryFg: palette.sand[100],
    disabledBg: palette.umber[800],
    disabledFg: palette.sand[600],
  },
  shadow: 'rgba(0, 0, 0, 0.55)',
};
