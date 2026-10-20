import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { readsAsNoIssues } from './no-issues';
import { buildOllamaChatBody, OLLAMA_KEEP_ALIVE } from './ollama';
import { runProviderChat } from './provider-chat';
import { isAbortError, isRequestTimeout, RequestTimeoutError, withTimeout } from './timeout';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('provider timeouts', () => {
  it('rejects when the server never responds', async () => {
    const server = http.createServer(() => {
      // Leave the socket open. This is the cold-start hang.
    });
    const port = await listen(server);
    const started = Date.now();
    try {
      await expect(
        runProviderChat({
          provider: 'openrouter',
          endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
          model: 'stub',
          messages: [{ role: 'user', content: 'hello' }],
          timeoutMs: 80,
        })
      ).rejects.toBeInstanceOf(RequestTimeoutError);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      server.closeAllConnections?.();
      await close(server);
    }
  });

  it('resolves a slow response that finishes inside the deadline', async () => {
    const server = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"issues":[]}' } }] }));
      }, 50);
    });
    const port = await listen(server);
    try {
      const content = await runProviderChat({
        provider: 'groq',
        endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
        model: 'stub',
        messages: [{ role: 'user', content: 'hello' }],
        timeoutMs: 400,
      });
      expect(content).toBe('{"issues":[]}');
    } finally {
      await close(server);
    }
  });

  it('rejects with AbortError when the caller cancels', async () => {
    const server = http.createServer(() => {});
    const port = await listen(server);
    const controller = new AbortController();
    const started = Date.now();
    const pending = runProviderChat({
      provider: 'ollama',
      endpoint: `http://127.0.0.1:${port}`,
      model: 'stub',
      messages: [{ role: 'user', content: 'hello' }],
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    try {
      await expect(pending).rejects.toSatisfy((error: unknown) => {
        return isAbortError(error) && !isRequestTimeout(error);
      });
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      server.closeAllConnections?.();
      await close(server);
    }
  });

  it('stops waiting on a message that never returns', async () => {
    const started = Date.now();
    await expect(
      withTimeout(new Promise(() => {}), 40, () => new RequestTimeoutError('late'))
    ).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('Ollama JSON mode', () => {
  it('posts native /api/chat with format json and keep_alive for a check', async () => {
    let url = '';
    let body: Record<string, unknown> = {};
    const server = http.createServer((req, res) => {
      url = req.url ?? '';
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: { role: 'assistant', content: '{"issues":[]}' } }));
      });
    });
    const port = await listen(server);
    try {
      const content = await runProviderChat({
        provider: 'ollama',
        endpoint: `http://127.0.0.1:${port}`,
        model: 'llama3.2',
        messages: [
          { role: 'system', content: 'Return JSON' },
          { role: 'user', content: 'hello' },
        ],
        temperature: 0.2,
        json: true,
        timeoutMs: 1000,
      });
      expect(content).toBe('{"issues":[]}');
      expect(url).toBe('/api/chat');
      expect(body).toMatchObject({
        model: 'llama3.2',
        stream: false,
        format: 'json',
        keep_alive: OLLAMA_KEEP_ALIVE,
        options: { temperature: 0.2 },
      });
      expect(body).not.toHaveProperty('response_format');
    } finally {
      await close(server);
    }
  });

  it('keeps translation as plain text and still pins keep_alive', () => {
    const body = buildOllamaChatBody({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'hello' }],
      json: false,
    });
    expect(body.keep_alive).toBe(OLLAMA_KEEP_ALIVE);
    expect(body.format).toBeUndefined();
    expect(body.stream).toBe(false);
  });
});

describe('no-issues replies', () => {
  it('treats an echo and a plain no-issues reply as clean', () => {
    expect(readsAsNoIssues('hello', 'hello')).toBe(true);
    expect(readsAsNoIssues('"hello"', 'hello')).toBe(true);
    expect(readsAsNoIssues('Hello', 'hello')).toBe(true);
    expect(readsAsNoIssues('No issues found.', 'hello')).toBe(true);
    expect(readsAsNoIssues('The text looks good.', 'i are baboon')).toBe(true);
    expect(readsAsNoIssues('There are no grammar errors.', 'hello')).toBe(true);
    expect(readsAsNoIssues('', 'hello')).toBe(true);
  });

  it('does not treat a real correction as clean', () => {
    expect(readsAsNoIssues('Hello!', 'hello')).toBe(false);
    expect(readsAsNoIssues('I am a baboon', 'i are baboon')).toBe(false);
  });
});
