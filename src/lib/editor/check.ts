import { completeChat } from '~/lib/ai/chat';
import { ISSUE_SYSTEM_PROMPT, IssueParseError, parseIssues, type GrammarIssue } from './issues';

/**
 * Ask the selected provider for suggestions. One retry when the reply is not the JSON contract.
 */
export async function fetchIssues(text: string, signal: AbortSignal): Promise<GrammarIssue[]> {
  const messages = [
    { role: 'system' as const, content: ISSUE_SYSTEM_PROMPT },
    { role: 'user' as const, content: text },
  ];
  const first = await completeChat({ messages, signal, temperature: 0.1, maxTokens: 700 });
  try {
    return parseIssues(first);
  } catch (error) {
    if (!(error instanceof IssueParseError)) throw error;
    const second = await completeChat({
      messages: [
        ...messages,
        { role: 'assistant', content: first.slice(0, 4000) },
        {
          role: 'user',
          content:
            'That reply was not valid. Respond again with only the JSON object {"issues":[...]}. No markdown and no explanation.',
        },
      ],
      signal,
      temperature: 0,
      maxTokens: 700,
    });
    return parseIssues(second);
  }
}
