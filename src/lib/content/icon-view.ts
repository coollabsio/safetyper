/**
 * Shadow-DOM face for the in-field icon. Page CSS cannot restyle the mark.
 */

import iconCss from '../../styles/icon-widget.css?inline';
import type { SuggestionGroupId } from './group-colors';
import { groupFill } from './group-colors';
import { iconAriaLabel, suggestionTooltip, type IconActivity } from './icon-state';

/** Solid pixels from public/icon/16.png. Drawn at 1× inside the 16px disc. */
const MARK_SMALL = `<svg class="mark mark-small" viewBox="0 0 8 10" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true"><rect x="2" y="0" width="5" height="1"/><rect x="1" y="1" width="7" height="1"/><rect x="0" y="2" width="8" height="1"/><rect x="0" y="3" width="6" height="1"/><rect x="1" y="4" width="6" height="1"/><rect x="2" y="5" width="6" height="1"/><rect x="0" y="6" width="8" height="1"/><rect x="0" y="7" width="8" height="1"/><rect x="0" y="8" width="7" height="1"/></svg>`;

/** Solid pixels from public/icon/32.png. Drawn at 1× inside the 28px disc. */
const MARK_MEDIUM = `<svg class="mark mark-medium" viewBox="0 0 16 18" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true"><rect x="3" y="0" width="12" height="1"/><rect x="3" y="1" width="12" height="1"/><rect x="3" y="2" width="13" height="1"/><rect x="0" y="3" width="16" height="1"/><rect x="0" y="4" width="3" height="1"/><rect x="5" y="4" width="11" height="1"/><rect x="0" y="5" width="5" height="1"/><rect x="0" y="6" width="5" height="1"/><rect x="1" y="7" width="10" height="1"/><rect x="2" y="8" width="11" height="1"/><rect x="3" y="9" width="10" height="1"/><rect x="4" y="10" width="11" height="1"/><rect x="5" y="11" width="11" height="1"/><rect x="11" y="12" width="5" height="1"/><rect x="0" y="13" width="16" height="1"/><rect x="0" y="14" width="12" height="1"/><rect x="13" y="14" width="3" height="1"/><rect x="0" y="15" width="13" height="1"/><rect x="0" y="16" width="13" height="1"/><rect x="1" y="17" width="12" height="1"/></svg>`;

const CLEAN = `<span class="badge clean-badge" aria-hidden="true"><svg viewBox="0 0 12 12" fill="none"><path d="M2.8 6.2 5 8.4 9.3 3.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

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
    face.innerHTML = `<span class="ring"></span>${MARK_SMALL}${MARK_MEDIUM}<span class="num"></span><span class="badge count-badge"></span>${CLEAN}<span class="tip" role="tooltip"></span>`;
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
  host.style.setProperty('--st-state', groupFill(options.group, 'light'));
  host.style.setProperty('--st-ink', '#ffffff');

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
  const badge = shadow.querySelector('.count-badge');
  if (num) num.textContent = digits;
  if (badge) badge.textContent = digits;
}

export function readIconLabel(host: HTMLElement): string {
  const face = host.shadowRoot?.querySelector('.face');
  return face?.getAttribute('aria-label') ?? '';
}
