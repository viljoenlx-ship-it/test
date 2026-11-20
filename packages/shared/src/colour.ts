/** Brand colours stay decorative unless they meet WCAG AA on white. */

const HEX = /^#[0-9a-fA-F]{6}$/;

export function parseHexColour(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HEX.test(value.trim())) {
    throw new Error(`${label} must be a colour such as #4338CA.`);
  }
  return value.trim().toLowerCase();
}

function channel(hex: string, index: number): number {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

function linear(channelByte: number): number {
  const s = channelByte / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background = '#ffffff'): number {
  const luminance = (hex: string) => {
    const r = linear(channel(hex, 0));
    const g = linear(channel(hex, 1));
    const b = linear(channel(hex, 2));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Sampled from the Omnivate icon and wordmark.
 * Icon ring indigo #4020a0, icon ring teal #08b8b8.
 * Wordmark indigo #281878. Teal ink is the same hue, dark enough to read on white.
 */
export const brandColours = {
  indigo: '#4020a0',
  teal: '#08b8b8',
  wordmark: '#281878',
  tealInk: '#087a80',
} as const;

export const FALLBACK_BRAND = brandColours.wordmark;

/**
 * Raw tenant colours paint the mark and the thin bar.
 * Text and focus use the colour only when it is dark enough on white.
 */
export function brandPresentation(
  primary: string,
  accent: string,
): {
  mark: string;
  accent: string;
  text: string;
} {
  const mark = parseHexColour(primary, 'Primary colour');
  const accentColour = parseHexColour(accent, 'Accent colour');
  return {
    mark,
    accent: accentColour,
    text: contrastRatio(mark) >= 4.5 ? mark : FALLBACK_BRAND,
  };
}
