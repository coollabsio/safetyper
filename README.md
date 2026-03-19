# SafeTyper

> AI-powered grammar and spelling checker for web browsers

SafeTyper is a browser extension that provides real-time grammar and spelling suggestions powered by AI models through [OpenRouter](https://openrouter.ai) or [Groq](https://groq.com).

## Features

- **Universal Input Detection** — works on any editable field across the web
- **Multiple AI Providers** — OpenRouter (GPT, Claude, Gemini, Llama) and Groq (Llama, Gemma, Mixtral)
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

You'll need [Bun](https://bun.sh/) (or Node.js 18+) and an API key from [OpenRouter](https://openrouter.ai/keys) or [Groq](https://console.groq.com/keys).

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

## CI/CD

Automated publishing via GitHub Actions:

- **Chrome Web Store** — triggered on version tags (`v*.*.*`) or manual dispatch
- **Firefox Add-ons (AMO)** — triggered on version tags (`v*.*.*`) or manual dispatch

Both workflows run lint, format check, and type checking before building. See `.env.example` for required secrets.

## Tech Stack

[WXT](https://wxt.dev) · [Svelte 5](https://svelte.dev) · TypeScript · ESLint · Prettier

## License

Apache 2.0 — see [LICENSE](LICENSE)
