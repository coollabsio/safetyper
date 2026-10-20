/**
 * Shadow-DOM face for the in-field icon. Page CSS cannot restyle the mark.
 */

import iconCss from '../../styles/icon-widget.css?inline';
import type { SuggestionGroupId } from './group-colors';
import { groupFill } from './group-colors';
import { iconAriaLabel, suggestionTooltip, type IconActivity } from './icon-state';

const MARK = `<svg class="mark" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M11.4 4.15c-.35-1.15-1.55-1.9-3.15-1.9-2.15 0-3.55 1.15-3.55 2.75 0 1.7 1.45 2.35 3.85 2.8 1.9.35 3.15.9 3.15 2.2 0 1.35-1.4 2.35-3.5 2.35-1.6 0-2.9-.55-3.5-1.55" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>`;

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
