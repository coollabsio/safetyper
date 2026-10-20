/**
 * Decide when a model reply means the passage is already clean.
 * Small models often skip the JSON contract and echo the text or say there is nothing to change.
 */

const NO_ISSUE_REPLY =
  /^(?:no (?:issues?|problems?|errors?|corrections?|suggestions?|changes?|mistakes?)(?:\s+(?:found|detected|needed|required))?[.!]?(?:\s+here)?|nothing (?:to (?:change|correct|fix)|wrong)[.!?]?|looks (?:good|fine|correct)[.!?]?|all good[.!?]?|(?:the |this )?(?:text|sentence|passage|input|message|word) (?:is |looks )?(?:already )?(?:correct|fine|good|clean|ok|okay)[.!?]?|there (?:are|is) no (?:grammar |spelling |punctuation )?(?:issues?|problems?|errors?|corrections?|mistakes?)[.!?]?|no (?:grammar|spelling|punctuation)(?: or (?:grammar|spelling|punctuation))? (?:issues?|errors?|problems?|mistakes?)[.!?]?|i (?:don't|do not) see any (?:issues?|errors?|problems?|mistakes?)[.!]?)$/i;

function unwrapReply(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  text = text.replace(/^(?:sure|okay|ok|done)[,!:.\s]+/i, '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('“') && text.endsWith('”'))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function canon(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * True when the reply is empty, repeats the passage, or says there is nothing to change.
 * A JSON issues payload is handled by the parser before this runs.
 */
export function readsAsNoIssues(raw: string, original: string): boolean {
  const text = unwrapReply(raw);
  if (!text) return true;
  if (canon(text) === canon(original)) return true;
  if (text.length > 280) return false;
  return NO_ISSUE_REPLY.test(text);
}
