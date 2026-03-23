# SafeTyper

> AI-powered grammar and spelling checker for web browsers

SafeTyper is a browser extension that provides real-time grammar and spelling suggestions powered by AI models through [OpenRouter](https://openrouter.ai), [Groq](https://groq.com), or a local [Ollama](https://ollama.com) instance.

## Features

- **Universal Input Detection** — works on any editable field across the web
- **Multiple AI Providers** — OpenRouter (GPT, Claude, Gemini, Llama), Groq (Llama, Gemma, Mixtral), and Ollama (local models)
- **Smart Caching** — reduces API calls and improves response time
- **Visual Diff Display** — inline highlighting of changes
- **Adaptive Icon Positioning** — smart placement for any input field size
- **Multi-Browser** — Chrome and Firefox with automated publishing
- **Privacy-First** — secure API key storage, rate limiting, key format validation

## Quick Start

1. Install dependencies: `bun install`
2. (Optional) Create `.env` from `.env.example` with your API key
3. Start dev server: `bun run dev` (Chrome) or `bun run dev:firefox` (Firefox)
4. Load the extension in your browser
5. Configure your API key in the extension popup (or it auto-loads from `.env` in dev mode)

You'll need [Bun](https://bun.sh/) (or Node.js 18+) and an API key from [OpenRouter](https://openrouter.ai/keys) or [Groq](https://console.groq.com/keys), or a local [Ollama](https://ollama.com) instance.

## Development

### Environment Variables

Copy `.env.example` to `.env` for dev mode:

```env
VITE_OPENROUTER_API_KEY=sk-or-v1-...
VITE_GROQ_API_KEY=gsk_...
```

Keys auto-load in development only. The `.env` file is git-ignored.

### Scripts

```bash
bun run dev              # Chrome dev server
bun run dev:firefox      # Firefox dev server
bun run build            # Build for Chrome
bun run build:firefox    # Build for Firefox
bun run zip              # Chrome distribution zip
bun run zip:firefox      # Firefox distribution zip
bun run check            # Type checking
bun run lint             # ESLint
bun run lint:fix         # ESLint with auto-fix
bun run format           # Prettier
bun run format:check     # Check formatting
```

### Project Structure

```
src/
├── entrypoints/
│   ├── background.ts        # Service worker (API key injection)
│   ├── content.ts           # Content script (input detection)
│   └── popup/               # Extension popup UI (Svelte 5)
├── lib/content/
│   ├── api-client.ts        # Provider-aware API client with caching
│   ├── config.ts            # Provider configurations
│   ├── diff-engine.ts       # Text diff implementation
│   ├── dom-utils.ts         # DOM utilities & icon positioning
│   ├── state-manager.ts     # State management
│   ├── types.ts             # TypeScript definitions
│   └── ui-manager.ts        # UI manager
├── styles/                  # Content script CSS
└── assets/                  # Fonts & images
```

## Using with Ollama

SafeTyper supports [Ollama](https://ollama.com) as a local, private provider — no API key needed.

### Setup

1. [Install Ollama](https://ollama.com/download) and pull a model (e.g. `ollama pull llama3.1`)
2. Configure `OLLAMA_ORIGINS` to allow the browser extension to connect (see below)
3. In the SafeTyper popup, select **Ollama** as the provider and pick your model

### Configuring `OLLAMA_ORIGINS`

By default, Ollama only accepts requests from `localhost`. Browser extensions use a different origin (`chrome-extension://...` or `moz-extension://...`), so Ollama will block requests unless you allow it.

Set `OLLAMA_ORIGINS` to `*` to allow all origins, or to your specific extension origin:

**macOS:**

```bash
launchctl setenv OLLAMA_ORIGINS "*"
```

Then restart the Ollama application.

**Linux (systemd):**

```bash
sudo systemctl edit ollama
```

Add under `[Service]`:

```ini
[Service]
Environment="OLLAMA_ORIGINS=*"
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

**Windows:**

Set `OLLAMA_ORIGINS` as a system environment variable to `*`, then restart Ollama.

**Running from the terminal (any OS):**

```bash
OLLAMA_ORIGINS="*" ollama serve
```

### Custom Endpoint

The default endpoint is `http://localhost:11434`. If your Ollama instance runs on a different host or port, you can change it in the extension popup under the Ollama provider settings.

## CI/CD

Automated publishing via GitHub Actions:

- **Chrome Web Store** — triggered on version tags (`v*.*.*`) or manual dispatch
- **Firefox Add-ons (AMO)** — triggered on version tags (`v*.*.*`) or manual dispatch

Both workflows run lint, format check, and type checking before building. See `.env.example` for required secrets.

## Tech Stack

[WXT](https://wxt.dev) · [Svelte 5](https://svelte.dev) · TypeScript · ESLint · Prettier

## License

Apache 2.0 — see [LICENSE](LICENSE)
