/**
 * Primitive colour palette (V2).
 *
 * Raw values with no meaning attached. Nothing imports this except
 * `semantic.ts` — screens consume semantic tokens, which is what lets the whole
 * product be re-skinned without touching a screen.
 *
 * V2 direction: warm neutrals rather than cool grey-blue. Cool neutrals read as
 * software; warm ones read as paper and objects, which is what an app about the
 * things you own should feel like. The brand accent is a deep pine green —
 * protection and permanence — which also keeps blue out of the palette entirely
 * so the "generic tech product" association never arrives.
 */

export const palette = {
  /** Warm charcoal. The brand's resting ink — replaces V1's navy. */
  ink: {
    950: '#100D0B',
    900: '#1C1917',
    800: '#231F1C',
    700: '#332D26',
    600: '#453D34',
  },

  /** Warm neutrals for canvas, surfaces, borders and secondary text. */
  sand: {
    50: '#FAF8F5',
    100: '#F5F1EC',
    200: '#EAE3DB',
    300: '#DBD1C6',
    400: '#BCAFA3',
    500: '#9C918A',
    600: '#6B625B',
    700: '#514A44',
    800: '#3A342F',
    900: '#262220',
  },

  /** Dark-theme surfaces. Lightness-differentiated, so borders are rarely needed. */
  umber: {
    950: '#16130F',
    900: '#211D19',
    800: '#2B2620',
    700: '#2F2923',
    600: '#3D362E',
  },

  /** Pine — the brand accent, and the colour of something being protected. */
  pine: {
    50: '#E8F5EF',
    100: '#DCF2E8',
    300: '#6FCFAC',
    400: '#4FBF97',
    500: '#1F6F5C',
    600: '#0F7355',
    700: '#0B5741',
  },

  /** Warm amber — attention, never alarm. */
  amber: {
    100: '#FDF0DA',
    300: '#E8B45E',
    400: '#D19A3C',
    500: '#A8620A',
    600: '#824B06',
  },

  /** Coral-red — expired and error. Warmer and less shouty than a pure red. */
  coral: {
    100: '#FBE3E0',
    300: '#F0918A',
    400: '#E06B62',
    500: '#B0332B',
    600: '#8A2620',
  },

  /**
   * Iris — reserved exclusively for derived and AI-assisted content, so the
   * colour itself teaches the user "this was worked out, not entered".
   */
  iris: {
    100: '#EDE9FB',
    300: '#A99BF0',
    400: '#8878E6',
    500: '#5B4BB8',
    600: '#453A8F',
  },

  /** Clay — a quiet secondary for illustration accents. */
  clay: {
    100: '#F7E9E1',
    300: '#DFA98C',
    400: '#C98A67',
    500: '#9C5B38',
  },

  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;
