/**
 * Persisted in-field icon size. Placement keeps its candidate order and only
 * reads the pixel size from here.
 */

export const ICON_SIZE_SETTINGS = ['small', 'medium', 'hidden'] as const;

export type IconSizeSetting = (typeof ICON_SIZE_SETTINGS)[number];

export const ICON_PIXELS = {
  small: 16,
  medium: 28,
} as const;

let setting: IconSizeSetting = 'small';

export function getIconSizeSetting(): IconSizeSetting {
  return setting;
}

export function setIconSizeSetting(value: unknown): void {
  setting = value === 'medium' || value === 'hidden' || value === 'small' ? value : 'small';
}

/** Pixel box used by placement. Hidden still reports the small size so math stays valid. */
export function iconPixelSize(): number {
  return setting === 'medium' ? ICON_PIXELS.medium : ICON_PIXELS.small;
}

export function iconIsHidden(): boolean {
  return setting === 'hidden';
}
