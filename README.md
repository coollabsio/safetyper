# SafeTyper

> AI-powered grammar and spelling checker for web browsers

SafeTyper is a browser extension that helps you write with confidence by providing real-time grammar and spelling suggestions powered by state-of-the-art AI models through OpenRouter.

## ✨ Features

- **🎯 Universal Input Detection**: Works on any editable field across the web
- **🤖 Multiple AI Models**: Support for GPT, Claude, Gemini, Llama, and more
- **⚡ Smart Caching**: Reduces API calls and improves response time
- **🎨 Visual Diff Display**: See exactly what changed with inline highlighting
- **🔒 Privacy-First**: Secure API key storage and rate limiting
- **📱 Responsive UI**: Draggable popup interface that adapts to your screen
- **🌐 Multi-Browser Support**: Chrome and Firefox compatible
- **♿ Accessible**: Full keyboard navigation and ARIA support

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh/) installed (recommended) or Node.js 18+
- An [OpenRouter API key](https://openrouter.ai/keys)

### Installation

1. Clone the repository
2. Install dependencies: `bun install`
3. **(Optional for dev)** Create `.env` file:
   ```bash
   cp .env.example .env
   # Edit .env and add your OpenRouter API key
   ```
4. Start development server: `bun run dev`
5. Load the extension in your browser
6. Configure your OpenRouter API key (or it will auto-load from .env in dev mode)

## 🛠️ Development

### Environment Variables (Dev Mode Only)

For development convenience, you can store your OpenRouter API key in a `.env` file:

1. Copy the example file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your real API key:
   ```env
   VITE_OPENROUTER_API_KEY=sk-or-v1-your-actual-key-here
   ```

3. The extension will automatically load this key in development mode!

**Benefits:**
- ✅ No need to enter API key every time you reload the extension
- ✅ Keys are stored securely in `.env` (git-ignored)
- ✅ Visual indicator shows when key is auto-loaded
- ✅ Only works in development mode (security)

**Note:** The `.env` file is automatically ignored by git, so your API key won't be committed.

### Available Scripts

```bash
bun run dev              # Start Chrome dev server
bun run dev:firefox      # Start Firefox dev server
bun run build            # Build for Chrome
bun run build:firefox    # Build for Firefox
bun run check            # Run type checking
bun run lint             # Run ESLint
bun run format           # Format code with Prettier
```

### Project Structure

```
src/
├── entrypoints/         # Extension entry points
├── lib/content/         # Content script modules
├── styles/              # CSS styles
└── assets/              # Static assets
```

## 🏗️ Architecture

SafeTyper uses a modular architecture with:
- State Management
- DOM Utilities
- API Client with caching
- Efficient diff engine
- UI Manager

## 🔐 Security Features

- ✅ Secure API key storage
- ✅ Rate limiting (10 requests/minute)
- ✅ API key format validation
- ✅ Message origin validation
- ✅ Content Security Policy

## 📄 License

MIT © SafeTyper Team
