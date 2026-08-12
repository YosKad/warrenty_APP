import { palette } from './palette';

/**
 * Semantic colour tokens.
 *
 * Every colour a screen uses is named for its *role*, never its value. The light and
 * dark maps must stay structurally identical — the `SemanticColors` type enforces
 * that, so a token added to one theme fails to compile until it exists in both.
 *
 * Contrast: all `text.*` on their matching `bg.*` meet WCAG AA (4.5:1) for body
 * sizes; `text.tertiary` is reserved for large or non-essential text.
 */

export type SemanticColors = {
  bg: {
    /** The page behind everything. */
    canvas: string;
    /** Raised content: cards, sheets, list groups. */
    surface: string;
    /** Recessed fills: input backgrounds, segmented tracks, skeletons. */
    subtle: string;
    /** Full-bleed brand surface, e.g. the warranty card and onboarding. */
    brand: string;
    /** Scrim behind modals and bottom sheets. */
    scrim: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    /** Text placed on `bg.brand` or on a filled accent button. */
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
  /** Warranty lifecycle states. Never the only signal — always paired with a label. */
  status: {
    activeFg: string;
    activeBg: string;
    endingFg: string;
    endingBg: string;
    expiredFg: string;
    expiredBg: string;
    neutralFg: string;
    neutralBg: string;
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
    /** Filled primary button. */
    primaryBg: string;
    primaryBgPressed: string;
    primaryFg: string;
    /** Quiet secondary button. */
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
    canvas: palette.slate[50],
    surface: palette.white,
    subtle: palette.slate[100],
    brand: palette.ink[900],
    scrim: 'rgba(5, 8, 15, 0.45)',
  },
  text: {
    primary: palette.ink[900],
    secondary: palette.slate[600],
    tertiary: palette.slate[500],
    onBrand: palette.white,
    accent: palette.blue[600],
    danger: palette.red[500],
  },
  border: {
    subtle: palette.slate[200],
    default: palette.slate[300],
    strong: palette.slate[400],
    focus: palette.blue[500],
  },
  accent: {
    solid: palette.blue[600],
    solidPressed: palette.blue[700],
    soft: palette.blue[50],
    text: palette.blue[600],
  },
  status: {
    activeFg: palette.green[500],
    activeBg: palette.green[100],
    endingFg: palette.amber[500],
    endingBg: palette.amber[100],
    expiredFg: palette.red[500],
    expiredBg: palette.red[100],
    neutralFg: palette.slate[600],
    neutralBg: palette.slate[100],
  },
  feedback: {
    successFg: palette.green[500],
    successBg: palette.green[100],
    warningFg: palette.amber[500],
    warningBg: palette.amber[100],
    dangerFg: palette.red[500],
    dangerBg: palette.red[100],
    infoFg: palette.cyan[600],
    infoBg: palette.cyan[100],
  },
  control: {
    primaryBg: palette.ink[900],
    primaryBgPressed: palette.ink[700],
    primaryFg: palette.white,
    secondaryBg: palette.slate[100],
    secondaryBgPressed: palette.slate[200],
    secondaryFg: palette.ink[900],
    disabledBg: palette.slate[200],
    disabledFg: palette.slate[400],
  },
  shadow: 'rgba(11, 18, 32, 0.10)',
};

export const darkColors: SemanticColors = {
  bg: {
    canvas: palette.ink[950],
    surface: palette.ink[900],
    subtle: palette.ink[800],
    brand: palette.ink[800],
    scrim: 'rgba(0, 0, 0, 0.6)',
  },
  text: {
    primary: palette.slate[50],
    secondary: palette.slate[400],
    tertiary: palette.slate[500],
    onBrand: palette.white,
    accent: palette.blue[300],
    danger: palette.red[300],
  },
  border: {
    subtle: palette.ink[700],
    default: palette.ink[600],
    strong: palette.slate[700],
    focus: palette.blue[400],
  },
  accent: {
    solid: palette.blue[500],
    solidPressed: palette.blue[600],
    soft: 'rgba(31, 111, 235, 0.18)',
    text: palette.blue[300],
  },
  status: {
    activeFg: palette.green[300],
    activeBg: 'rgba(47, 183, 131, 0.16)',
    endingFg: palette.amber[300],
    endingBg: 'rgba(224, 160, 56, 0.16)',
    expiredFg: palette.red[300],
    expiredBg: 'rgba(235, 106, 96, 0.16)',
    neutralFg: palette.slate[400],
    neutralBg: 'rgba(163, 171, 185, 0.12)',
  },
  feedback: {
    successFg: palette.green[300],
    successBg: 'rgba(47, 183, 131, 0.16)',
    warningFg: palette.amber[300],
    warningBg: 'rgba(224, 160, 56, 0.16)',
    dangerFg: palette.red[300],
    dangerBg: 'rgba(235, 106, 96, 0.16)',
    infoFg: palette.cyan[300],
    infoBg: 'rgba(51, 189, 214, 0.16)',
  },
  control: {
    primaryBg: palette.slate[50],
    primaryBgPressed: palette.slate[300],
    primaryFg: palette.ink[950],
    secondaryBg: palette.ink[800],
    secondaryBgPressed: palette.ink[700],
    secondaryFg: palette.slate[50],
    disabledBg: palette.ink[800],
    disabledFg: palette.slate[600],
  },
  shadow: 'rgba(0, 0, 0, 0.5)',
};
