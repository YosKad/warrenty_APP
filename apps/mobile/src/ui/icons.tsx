import { I18nManager } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme';

/**
 * Icon set.
 *
 * Hand-drawn SVGs rather than an icon font: a font ships thousands of glyphs to use
 * a dozen, and cannot be theme-aware. Every icon is a single 1.75pt stroke on a
 * 24×24 grid, which is what makes them look like one family.
 *
 * Directional icons (chevron, back, share) mirror under RTL. Non-directional ones
 * (shield, camera, bell) must not — a mirrored camera icon just looks broken.
 */

export type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

function useIconColor(color?: string): string {
  const theme = useTheme();
  return color ?? theme.colors.text.primary;
}

export function ChevronIcon({ size = 20, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
    >
      <Path
        d="M9 5l7 7-7 7"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function BackIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
    >
      <Path
        d="M15 5l-7 7 7 7"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CloseIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 6l12 12M18 6L6 18"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function HomeIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 10.5L12 4l8 6.5V19a1 1 0 01-1 1h-4v-5h-6v5H5a1 1 0 01-1-1v-8.5z"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * The product mark: a rounded rectangle (an owned object) with a time arc across it.
 * Ownership plus duration — the two ideas the whole app is about — without resorting
 * to a shield.
 */
export function WarrantyMarkIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={3.5}
        y={5}
        width={17}
        height={14}
        rx={3.5}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <Path
        d="M8 15.5c1.2-3.4 3.1-5.2 5.6-5.4"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M11.6 8.4l2.4 1.6-1.7 2.2"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PlusIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function BellIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 9.5a6 6 0 0112 0c0 3.2.7 4.9 1.5 5.9.3.4 0 1.1-.6 1.1H5.1c-.6 0-.9-.7-.6-1.1.8-1 1.5-2.7 1.5-5.9z"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Path d="M10 19.5a2.2 2.2 0 004 0" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function PersonIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8.5} r={3.75} stroke={stroke} strokeWidth={strokeWidth} />
      <Path
        d="M4.5 20c.7-3.6 3.8-5.5 7.5-5.5s6.8 1.9 7.5 5.5"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function SearchIcon({ size = 20, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={6.5} stroke={stroke} strokeWidth={strokeWidth} />
      <Path d="M16 16l4 4" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function CameraIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8.5h3l1.4-2.2h7.2L17 8.5h3a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1v-8a1 1 0 011-1z"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={13.5} r={3.25} stroke={stroke} strokeWidth={strokeWidth} />
    </Svg>
  );
}

export function DocumentIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M13.5 3.5H7a1.5 1.5 0 00-1.5 1.5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8.5l-5-5z"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Path d="M13.5 3.5v5h5" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </Svg>
  );
}

export function CheckIcon({ size = 20, color, strokeWidth = 2 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function InfoIcon({ size = 18, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={stroke} strokeWidth={strokeWidth} />
      <Path d="M12 11v5" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx={12} cy={8} r={0.9} fill={stroke} />
    </Svg>
  );
}

export function BarcodeIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7V5.5A1.5 1.5 0 015.5 4H7M17 4h1.5A1.5 1.5 0 0120 5.5V7M20 17v1.5a1.5 1.5 0 01-1.5 1.5H17M7 20H5.5A1.5 1.5 0 014 18.5V17"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M8 8.5v7M11 8.5v7M14 8.5v7M16.5 8.5v7"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function PencilIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15.5 5.5l3 3L9 18H6v-3l9.5-9.5z"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
