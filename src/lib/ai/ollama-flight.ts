/**
 * One live provider request per tab and feature.
 * A newer request aborts the previous AbortController, which closes the HTTP
 * connection. Ollama stops generating when that connection drops.
 */

export type OllamaFeature = 'auto-check' | 'card' | 'translate' | 'editor';

export function featureForRequest(action: string, requestId: string): OllamaFeature {
  if (action === 'translate') return 'translate';
  if (requestId.startsWith('auto-')) return 'auto-check';
  return 'card';
}

export class OllamaFlight {
  private current = new Map<string, AbortController>();

  private slot(scope: string, feature: OllamaFeature): string {
    return `${scope}:${feature}`;
  }

  /**
   * Begin a request in this scope and feature.
   * The controller already running there is aborted first.
   */
  start(scope: string, feature: OllamaFeature): AbortController {
    const key = this.slot(scope, feature);
    this.current.get(key)?.abort();
    const controller = new AbortController();
    this.current.set(key, controller);
    return controller;
  }

  abort(scope: string, feature: OllamaFeature): void {
    this.current.get(this.slot(scope, feature))?.abort();
  }

  finish(scope: string, feature: OllamaFeature, controller: AbortController): void {
    const key = this.slot(scope, feature);
    if (this.current.get(key) === controller) this.current.delete(key);
  }
}
