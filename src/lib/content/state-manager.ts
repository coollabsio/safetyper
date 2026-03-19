/**
 * State management for SafeTyper content script
 */

import type { ContentScriptState, Position } from './types';
import { CONFIG } from './config';

/**
 * Create and manage content script state
 */
export function createState(): ContentScriptState {
  return {
    activeInput: null,
    iconContainer: null,
    popup: null,
    typingTimer: null,
    isTyping: false,
    isComposing: false,
    lastTypingTime: 0,
    typingSpeedHistory: [],
    cachedPosition: null,
    lastInputRect: null,
  };
}

/**
 * State manager class
 */
export class StateManager {
  private state: ContentScriptState;

  constructor() {
    this.state = createState();
  }

  // Getters
  getActiveInput(): HTMLElement | null {
    return this.state.activeInput;
  }

  getIconContainer(): HTMLDivElement | null {
    return this.state.iconContainer;
  }

  getPopup(): HTMLDivElement | null {
    return this.state.popup;
  }

  getTypingTimer(): number | null {
    return this.state.typingTimer;
  }

  isTypingActive(): boolean {
    return this.state.isTyping;
  }

  isComposingActive(): boolean {
    return this.state.isComposing;
  }

  getLastTypingTime(): number {
    return this.state.lastTypingTime;
  }

  getTypingSpeedHistory(): number[] {
    return this.state.typingSpeedHistory;
  }

  getCachedPosition(): Position | null {
    return this.state.cachedPosition;
  }

  getLastInputRect(): DOMRect | null {
    return this.state.lastInputRect;
  }

  // Setters
  setActiveInput(input: HTMLElement | null): void {
    this.state.activeInput = input;
  }

  setIconContainer(container: HTMLDivElement | null): void {
    this.state.iconContainer = container;
  }

  setPopup(popup: HTMLDivElement | null): void {
    this.state.popup = popup;
  }

  setTypingTimer(timer: number | null): void {
    // Clear existing timer if present
    if (this.state.typingTimer !== null) {
      clearTimeout(this.state.typingTimer);
    }
    this.state.typingTimer = timer;
  }

  setIsTyping(isTyping: boolean): void {
    this.state.isTyping = isTyping;
  }

  setIsComposing(isComposing: boolean): void {
    this.state.isComposing = isComposing;
  }

  setLastTypingTime(time: number): void {
    this.state.lastTypingTime = time;
  }

  addTypingSpeedMeasurement(timeDiff: number): void {
    this.state.typingSpeedHistory.push(timeDiff);
    if (this.state.typingSpeedHistory.length > CONFIG.TYPING_HISTORY_SIZE) {
      this.state.typingSpeedHistory.shift();
    }
  }

  setCachedPosition(position: Position | null): void {
    this.state.cachedPosition = position;
  }

  setLastInputRect(rect: DOMRect | null): void {
    this.state.lastInputRect = rect;
  }

  /**
   * Calculate adaptive debounce time based on typing speed
   */
  getAdaptiveDebounceTime(): number {
    if (this.state.typingSpeedHistory.length < 3) {
      return 150; // Default debounce time
    }

    const avgSpeed =
      this.state.typingSpeedHistory.reduce((a, b) => a + b, 0) /
      this.state.typingSpeedHistory.length;

    // Fast typing (< 100ms between keystrokes) - short debounce
    if (avgSpeed < 100) {
      return 50;
    }
    // Moderate typing (100-200ms) - medium debounce
    else if (avgSpeed < 200) {
      return 100;
    }
    // Slow typing (> 200ms) - longer debounce to avoid flickering
    else {
      return 200;
    }
  }

  /**
   * Cleanup all state
   */
  cleanup(): void {
    // Clear timer
    if (this.state.typingTimer !== null) {
      clearTimeout(this.state.typingTimer);
    }

    // Remove DOM elements
    if (this.state.iconContainer) {
      this.state.iconContainer.remove();
    }

    if (this.state.popup) {
      this.state.popup.remove();
    }

    // Reset state
    this.state = createState();
  }
}

// Export singleton instance
export const stateManager = new StateManager();
