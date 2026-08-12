/**
 * Primitive colour palette.
 *
 * These are raw values with no meaning attached. Nothing in the app should import
 * from this file except `semantic.ts` — screens and components consume semantic
 * tokens (`colors.text.primary`) so the whole product can be re-skinned, and later
 * re-branded, without touching a single screen.
 */

export const palette = {
  // Deep navy / near-black. The brand's resting state.
  ink: {
    950: '#05080F',
    900: '#0B1220',
    800: '#141C2E',
    700: '#1E2739',
    600: '#2B3547',
  },
  // Cool neutrals for surfaces, borders and secondary text.
  slate: {
    50: '#F7F8FA',
    100: '#F0F2F5',
    200: '#E3E6EC',
    300: '#CDD3DC',
    400: '#A3ABB9',
    500: '#78828F',
    600: '#5A6472',
    700: '#414A57',
    800: '#2C333D',
    900: '#1A1F26',
  },
  // Electric blue — used sparingly, for the single most important action per screen.
  blue: {
    50: '#EBF2FF',
    100: '#D6E4FF',
    300: '#7FAAFF',
    400: '#4D8DFF',
    500: '#1F6FEB',
    600: '#0B57D0',
    700: '#0A46A6',
  },
  // Refined cyan — the secondary brand accent (timelines, highlights, illustration).
  cyan: {
    100: '#D3F1F7',
    300: '#6FD3E5',
    400: '#33BDD6',
    500: '#0E9BB8',
    600: '#0A7A92',
  },
  green: {
    100: '#D7F2E6',
    300: '#5FCFA4',
    400: '#2FB783',
    500: '#12855F',
    600: '#0C6748',
  },
  amber: {
    100: '#FCEBCF',
    300: '#F2C066',
    400: '#E0A038',
    500: '#9A5B00',
    600: '#7A4700',
  },
  red: {
    100: '#FBDDDB',
    300: '#F5928A',
    400: '#EB6A60',
    500: '#B3261E',
    600: '#8C1D17',
  },
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;
