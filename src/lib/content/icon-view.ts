/**
 * Shadow-DOM face for the in-field icon. Page CSS cannot restyle the mark.
 */

import iconCss from '../../styles/icon-widget.css?inline';
import type { SuggestionGroupId } from './group-colors';
import { groupFill } from './group-colors';
import { iconAriaLabel, suggestionTooltip, type IconActivity } from './icon-state';

/** Exact opaque pixels from public/icon/32.png, cropped to the 18×19 glyph. */
const MARK = `<svg class="mark" viewBox="0 0 18 19" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true"><rect x="4" y="0" width="12" height="1"/><rect x="4" y="1" width="13" height="1"/><rect x="4" y="2" width="14" height="1"/><rect x="0" y="3" width="18" height="1"/><rect x="0" y="4" width="4" height="1"/><rect x="5" y="4" width="13" height="1"/><rect x="0" y="5" width="6" height="1"/><rect x="0" y="6" width="12" height="1"/><rect x="2" y="7" width="11" height="1"/><rect x="2" y="8" width="12" height="1"/><rect x="4" y="9" width="10" height="1"/><rect x="5" y="10" width="11" height="1"/><rect x="5" y="11" width="12" height="1"/><rect x="12" y="12" width="6" height="1"/><rect x="0" y="13" width="18" height="1"/><rect x="0" y="14" width="13" height="1"/><rect x="14" y="14" width="4" height="1"/><rect x="0" y="15" width="14" height="1"/><rect x="0" y="16" width="14" height="1"/><rect x="2" y="17" width="12" height="1"/><rect x="2" y="18" width="12" height="1"/></svg>`;

const CHECK = `<svg class="check" viewBox="0 0 16 16" aria-hidden="true">
  <path d="M3.4 8.2 6.5 11.3 12.7 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>`;

export interface IconFaceOptions {
  activity: IconActivity;
  count: number;
  countAsIcon: boolean;
  group: SuggestionGroupId | null;
  surface: 'light' | 'dark';
  onActivate?: (event: Event) => void;
}

export function mountIconFace(host: HTMLElement, options: IconFaceOptions): void {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (!shadow.querySelector('.face')) {
    const style = document.createElement('style');
    style.textContent = iconCss;
    const face = document.createElement('button');
    face.type = 'button';
    face.className = 'face';
    face.innerHTML = `<span class="ring"></span>${MARK}<span class="num"></span><span class="badge"></span>${CHECK}<span class="tip" role="tooltip"></span>`;
    shadow.append(style, face);
    face.addEventListener('mousedown', (event) => event.preventDefault());
  }
  const face = shadow.querySelector('.face');
  if (!(face instanceof HTMLButtonElement)) return;
  face.onclick = (event) => options.onActivate?.(event);

  const presentation = options.countAsIcon ? 'count' : options.count > 0 ? 'badge' : 'logo';
  host.setAttribute('data-state', options.activity);
  host.setAttribute('data-presentation', presentation);
  host.setAttribute('data-surface', options.surface);
  host.style.setProperty('--st-state', groupFill(options.group, options.surface));
  host.style.setProperty('--st-ink', options.surface === 'dark' ? '#18181b' : '#ffffff');

  const label = iconAriaLabel(options.activity, options.count);
  face.setAttribute('aria-label', label);
  face.removeAttribute('role');
  const tip = shadow.querySelector('.tip');
  const text = options.count > 0 ? suggestionTooltip(options.count) : '';
  if (tip) {
    tip.textContent = text;
    if (text) face.setAttribute('aria-describedby', 'st-icon-tip');
    else face.removeAttribute('aria-describedby');
    tip.id = 'st-icon-tip';
  }
  const digits = options.count > 9 ? '9+' : String(options.count);
  const num = shadow.querySelector('.num');
  const badge = shadow.querySelector('.badge');
  if (num) num.textContent = digits;
  if (badge) badge.textContent = digits;
}

export function readIconLabel(host: HTMLElement): string {
  const face = host.shadowRoot?.querySelector('.face');
  return face?.getAttribute('aria-label') ?? '';
}
