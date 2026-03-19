/**
 * Text diffing engine for SafeTyper
 * Uses a word-level diff algorithm for better performance
 */

import type { DiffOperation, WordGroup } from './types';
import { escapeHtml } from './dom-utils';

/**
 * Tokenize text into words and whitespace
 */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/**
 * Generate word-level diff operations between two texts
 * Uses dynamic programming for efficient computation
 */
export function diffTexts(oldText: string, newText: string): DiffOperation[] {
  const oldWords = tokenize(oldText);
  const newWords = tokenize(newText);

  // Create DP table for edit distance
  const dp: number[][] = Array(oldWords.length + 1)
    .fill(null)
    .map(() => Array(newWords.length + 1).fill(0));

  // Initialize base cases
  for (let i = 0; i <= oldWords.length; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= newWords.length; j++) {
    dp[0][j] = j;
  }

  // Fill DP table
  for (let i = 1; i <= oldWords.length; i++) {
    for (let j = 1; j <= newWords.length; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1, // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }

  // Backtrack to generate operations
  const operations: DiffOperation[] = [];
  let i = oldWords.length;
  let j = newWords.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      operations.unshift({ type: 'equal', text: oldWords[i - 1] });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      // Substitution - treat as delete + insert
      operations.unshift({ type: 'delete', text: oldWords[i - 1] });
      operations.unshift({ type: 'insert', text: newWords[j - 1] });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      operations.unshift({ type: 'delete', text: oldWords[i - 1] });
      i--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      operations.unshift({ type: 'insert', text: newWords[j - 1] });
      j--;
    }
  }

  return operations;
}

/**
 * Group diff operations for display
 */
function groupOperations(operations: DiffOperation[]): WordGroup[] {
  const wordGroups: WordGroup[] = [];
  let currentOriginal: string[] = [];
  let currentCorrected: string[] = [];

  for (const op of operations) {
    const isWhitespace = /\s+/.test(op.text);

    if (op.type === 'equal') {
      // Save any pending changes
      if (currentOriginal.length > 0 || currentCorrected.length > 0) {
        wordGroups.push({
          original: [...currentOriginal],
          corrected: [...currentCorrected],
        });
        currentOriginal = [];
        currentCorrected = [];
      }

      // Add unchanged token
      wordGroups.push({
        original: [op.text],
        corrected: [op.text],
      });
    } else if (op.type === 'delete') {
      currentOriginal.push(op.text);
    } else if (op.type === 'insert') {
      currentCorrected.push(op.text);
    }
  }

  // Handle remaining changes
  if (currentOriginal.length > 0 || currentCorrected.length > 0) {
    wordGroups.push({
      original: [...currentOriginal],
      corrected: [...currentCorrected],
    });
  }

  return wordGroups;
}

/**
 * Generate HTML with highlighted differences
 */
export function generateDiffHtml(oldText: string, newText: string): string {
  const operations = diffTexts(oldText, newText);
  const wordGroups = groupOperations(operations);

  let html = '<div class="diff-words-container">';

  for (const group of wordGroups) {
    const originalText = group.original.join('');
    const correctedText = group.corrected.join('');

    // Check if this group contains only whitespace
    const isWhitespaceGroup = /^\s+$/.test(originalText) && originalText === correctedText;

    if (isWhitespaceGroup) {
      // Handle whitespace - preserve it naturally
      html += escapeHtml(originalText);
    } else if (originalText === correctedText) {
      // No change - display normally
      html += `<span class="grammar-unchanged">${escapeHtml(originalText)}</span>`;
    } else {
      // Change detected - display with original and corrected versions
      html += `<span class="word-diff-group"><span class="original-word">${escapeHtml(originalText)}</span><span class="corrected-word">${escapeHtml(correctedText)}</span></span>`;
    }
  }

  html += '</div>';
  return html;
}
