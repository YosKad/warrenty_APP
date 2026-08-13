import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme';

/**
 * Category illustrations.
 *
 * V1 showed the same generic mark for every product, which turned a list of
 * things you own into a list of grey squares. These are real objects: a
 * television reads as a television, a vacuum as a vacuum. You should recognise
 * your product before you read a word of it.
 *
 * They cohere as a set the way an icon family does — one 32-unit grid, one
 * stroke weight, one accent fill used only for the "live" part of each object
 * (a screen, a drum, a dial) — while still being drawings rather than symbols.
 *
 * This is the *fallback*. Resolution order in ProductImage is:
 *   user photo → recognition image → this. There is nothing below it, because
 *   "unidentified object" is precisely the experience V2 removes.
 */

export type CategorySlug =
  | 'electronics'
  | 'appliances'
  | 'computers'
  | 'phones'
  | 'furniture'
  | 'tools'
  | 'automotive'
  | 'home-equipment'
  | 'baby'
  | 'jewelry'
  | 'watches'
  | 'audio'
  | 'vacuum'
  | 'other';

type Props = {
  category: string | null | undefined;
  size?: number;
  /** Product name, used to pick a more specific drawing than the category alone. */
  hint?: string | null;
};

/**
 * Refines the category using the product name. A "Dyson V15" sits in
 * `appliances`, but drawing it as a washing machine would be worse than useless —
 * the whole point is recognition.
 */
export function resolveIllustration(
  category: string | null | undefined,
  hint?: string | null,
): CategorySlug {
  const text = `${hint ?? ''}`.toLowerCase();

  if (/vacuum|hoover|dyson|v15|v11|stick/.test(text)) return 'vacuum';
  if (/headphone|earbud|airpod|wh-1000|buds|speaker|soundbar|sonos/.test(text)) return 'audio';
  if (/washer|washing|dryer|dishwasher|bosch serie|fridge|refrigerator|freezer|oven/.test(text)) {
    return 'appliances';
  }
  if (/macbook|laptop|notebook|thinkpad|surface|imac|pc\b/.test(text)) return 'computers';
  if (/iphone|galaxy|pixel|phone|xiaomi/.test(text)) return 'phones';
  if (/\btv\b|oled|qled|television|monitor|display|s95d|qn90/.test(text)) return 'electronics';
  if (/watch|garmin|fitbit/.test(text)) return 'watches';

  switch (category) {
    case 'electronics':
    case 'appliances':
    case 'computers':
    case 'phones':
    case 'furniture':
    case 'tools':
    case 'automotive':
    case 'home-equipment':
    case 'baby':
    case 'jewelry':
    case 'watches':
      return category;
    default:
      return 'other';
  }
}

export function ProductIllustration({ category, size = 48, hint }: Props) {
  const theme = useTheme();
  const slug = resolveIllustration(category, hint);

  const stroke = theme.colors.text.secondary;
  const accent = theme.colors.accent.solid;
  const sw = 1.6;

  const common = { stroke, strokeWidth: sw, strokeLinejoin: 'round' as const };

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
        {slug === 'electronics' ? (
          <>
            {/* Television — accent fills the panel, the part that matters */}
            <Rect x={3} y={6} width={26} height={16} rx={2} fill={accent} opacity={0.14} />
            <Rect x={3} y={6} width={26} height={16} rx={2} {...common} />
            <Path d="M12 26h8M16 22v4" {...common} strokeLinecap="round" />
          </>
        ) : null}

        {slug === 'computers' ? (
          <>
            <Rect x={5} y={7} width={22} height={14} rx={1.8} fill={accent} opacity={0.14} />
            <Rect x={5} y={7} width={22} height={14} rx={1.8} {...common} />
            <Path d="M2.5 24.5h27a1.5 1.5 0 001.2-2.4L29 21H3l-1.7 1.1a1.5 1.5 0 001.2 2.4z" {...common} />
          </>
        ) : null}

        {slug === 'phones' ? (
          <>
            <Rect x={9} y={3} width={14} height={26} rx={3} fill={accent} opacity={0.14} />
            <Rect x={9} y={3} width={14} height={26} rx={3} {...common} />
            <Path d="M14 6h4" {...common} strokeLinecap="round" />
            <Circle cx={16} cy={25.5} r={1.1} fill={stroke} />
          </>
        ) : null}

        {slug === 'appliances' ? (
          <>
            {/* Front-loading drum — the accent circle is instantly readable */}
            <Rect x={6} y={3} width={20} height={26} rx={2.5} {...common} />
            <Circle cx={16} cy={19} r={6} fill={accent} opacity={0.16} />
            <Circle cx={16} cy={19} r={6} {...common} />
            <Circle cx={16} cy={19} r={2.4} {...common} />
            <Path d="M10 8h6" {...common} strokeLinecap="round" />
            <Circle cx={22} cy={8} r={1.2} {...common} />
          </>
        ) : null}

        {slug === 'vacuum' ? (
          <>
            <Path d="M20 4l-3 14" {...common} strokeLinecap="round" />
            <Rect x={13} y={16} width={11} height={9} rx={2.5} fill={accent} opacity={0.16} transform="rotate(-12 18 20)" />
            <Rect x={13} y={16} width={11} height={9} rx={2.5} {...common} transform="rotate(-12 18 20)" />
            <Path d="M11 24l-4 4" {...common} strokeLinecap="round" />
            <Path d="M5 27.5h5" {...common} strokeLinecap="round" />
            <Circle cx={20.5} cy={4} r={1.8} {...common} />
          </>
        ) : null}

        {slug === 'audio' ? (
          <>
            <Path d="M6 19v-3a10 10 0 0120 0v3" {...common} strokeLinecap="round" />
            <Rect x={3} y={18} width={6} height={10} rx={3} fill={accent} opacity={0.18} />
            <Rect x={3} y={18} width={6} height={10} rx={3} {...common} />
            <Rect x={23} y={18} width={6} height={10} rx={3} fill={accent} opacity={0.18} />
            <Rect x={23} y={18} width={6} height={10} rx={3} {...common} />
          </>
        ) : null}

        {slug === 'watches' ? (
          <>
            <Rect x={10} y={9} width={12} height={14} rx={3.4} fill={accent} opacity={0.16} />
            <Rect x={10} y={9} width={12} height={14} rx={3.4} {...common} />
            <Path d="M13 9V5.5A1.5 1.5 0 0114.5 4h3A1.5 1.5 0 0119 5.5V9M13 23v3.5A1.5 1.5 0 0014.5 28h3a1.5 1.5 0 001.5-1.5V23" {...common} />
            <Path d="M16 13v3l2 1.4" {...common} strokeLinecap="round" />
          </>
        ) : null}

        {slug === 'furniture' ? (
          <>
            <Path d="M5 15v-3a2.5 2.5 0 015 0v3" {...common} />
            <Path d="M22 15v-3a2.5 2.5 0 015 0v3" {...common} />
            <Rect x={4} y={14} width={24} height={9} rx={2.5} fill={accent} opacity={0.14} />
            <Rect x={4} y={14} width={24} height={9} rx={2.5} {...common} />
            <Path d="M7 23v3M25 23v3" {...common} strokeLinecap="round" />
          </>
        ) : null}

        {slug === 'tools' ? (
          <>
            <Path d="M20.5 4a6 6 0 00-5.2 9L4.6 23.7a2.2 2.2 0 103.1 3.1L18.4 16a6 6 0 106.4-9.6l-3.2 3.2-2.9-.6-.6-2.9 3.2-3.2A6 6 0 0020.5 4z" fill={accent} opacity={0.14} />
            <Path d="M20.5 4a6 6 0 00-5.2 9L4.6 23.7a2.2 2.2 0 103.1 3.1L18.4 16a6 6 0 106.4-9.6l-3.2 3.2-2.9-.6-.6-2.9 3.2-3.2A6 6 0 0020.5 4z" {...common} />
          </>
        ) : null}

        {slug === 'automotive' ? (
          <>
            <Path d="M4 20v-3.2l2.4-5.4A2.4 2.4 0 018.6 10h14.8a2.4 2.4 0 012.2 1.4L28 16.8V20" fill={accent} opacity={0.14} />
            <Path d="M4 20v-3.2l2.4-5.4A2.4 2.4 0 018.6 10h14.8a2.4 2.4 0 012.2 1.4L28 16.8V20H4z" {...common} />
            <Circle cx={9.5} cy={20.5} r={2.6} {...common} />
            <Circle cx={22.5} cy={20.5} r={2.6} {...common} />
          </>
        ) : null}

        {slug === 'home-equipment' ? (
          <>
            <Path d="M4 14.5L16 5l12 9.5" {...common} strokeLinecap="round" />
            <Path d="M7 13v12a1.5 1.5 0 001.5 1.5h15A1.5 1.5 0 0025 25V13" fill={accent} opacity={0.14} />
            <Path d="M7 13v12a1.5 1.5 0 001.5 1.5h15A1.5 1.5 0 0025 25V13" {...common} />
            <Rect x={13} y={19} width={6} height={7.5} rx={1} {...common} />
          </>
        ) : null}

        {slug === 'baby' ? (
          <>
            <Path d="M6 20a10 10 0 0120 0" fill={accent} opacity={0.16} />
            <Path d="M6 20a10 10 0 0120 0H6z" {...common} />
            <Path d="M16 10v10" {...common} strokeLinecap="round" />
            <Circle cx={9} cy={25} r={2.2} {...common} />
            <Circle cx={23} cy={25} r={2.2} {...common} />
            <Path d="M6 20h20" {...common} strokeLinecap="round" />
          </>
        ) : null}

        {slug === 'jewelry' ? (
          <>
            <Path d="M10 5h12l5 7-11 15L5 12z" fill={accent} opacity={0.16} />
            <Path d="M10 5h12l5 7-11 15L5 12z" {...common} />
            <Path d="M5 12h22M10 5l6 7 6-7M16 12v15" {...common} />
          </>
        ) : null}

        {slug === 'other' ? (
          <>
            <Path d="M16 4l11 5.5v13L16 28 5 22.5v-13z" fill={accent} opacity={0.13} />
            <Path d="M16 4l11 5.5v13L16 28 5 22.5v-13z" {...common} />
            <Path d="M5 9.5L16 15l11-5.5M16 15v13" {...common} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}
