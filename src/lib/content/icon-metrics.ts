/**
 * Persisted in-field icon size. Placement keeps its candidate order and only
 * reads the pixel size from here. Medium is the original 24px disc.
 */

export const ICON_SIZE_SETTINGS = ['small', 'medium', 'hidden'] as const;

export type IconSizeSetting = (typeof ICON_SIZE_SETTINGS)[number];

export const ICON_PIXELS = {
  small: 18,
  medium: 24,
} as const;

let setting: IconSizeSetting = 'medium';

export function getIconSizeSetting(): IconSizeSetting {
  return setting;
}

export function setIconSizeSetting(value: unknown): void {
  setting = value === 'small' || value === 'hidden' || value === 'medium' ? value : 'medium';
}

/** Pixel box used by placement. Hidden still reports the original 24px disc. */
export function iconPixelSize(): number {
  return setting === 'small' ? ICON_PIXELS.small : ICON_PIXELS.medium;
}

export function iconIsHidden(): boolean {
  return setting === 'hidden';
}
