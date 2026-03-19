# Developer Setup Guide

Quick guide to get started with SafeTyper development.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
bun install
```

### 2. Configure API Key (Optional but Recommended)

Create a `.env` file from the example:
```bash
cp .env.example .env
```

Edit `.env` and add your OpenRouter API key:
```env
VITE_OPENROUTER_API_KEY=sk-or-v1-your-actual-64-character-hex-key-here
```

Get your API key from: https://openrouter.ai/keys

### 3. Start Development

```bash
# For Chrome
bun run dev

# For Firefox
bun run dev:firefox
```

### 4. Load Extension in Browser

**Chrome:**
1. Navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `.output/chrome-mv3` directory

**Firefox:**
1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select any file in the `.output/firefox-mv2` directory

## 🧪 Testing

### Open Test Page
1. Click the SafeTyper extension icon
2. Click "🧪 Open Test Page" button at the bottom (only in dev mode)
3. Test the extension on various input fields

### Manual Testing
Test on any website with input fields:
- Text inputs
- Textareas
- ContentEditable divs
- Forms

## ✅ Verification

Before committing, run:
```bash
# Type checking
bun run check

# Linting
bun run lint

# Formatting check
bun run format:check
```

## 💡 Tips

### API Key Auto-Loading
When you configure your API key in `.env`:
- ✅ It's automatically loaded in development mode
- ✅ You'll see a green indicator in the popup
- ✅ No need to enter it manually each time
- ✅ Works only in dev mode for security

### Hot Reload
The dev server supports hot reload:
- Changes to content scripts require a page refresh
- Changes to popup UI reload automatically
- Background script changes require extension reload

### Debug Logs
Check browser console for:
- Content script logs: Page console
- Background script logs: Extension service worker console
- Popup logs: Popup inspector

## 🔧 Common Issues

### API Key Not Loading
- Make sure the key is in `.env` with the exact format
- Restart the dev server after creating `.env`
- Check that the key starts with `sk-or-v1-`

### Extension Not Loading
- Make sure you're loading from the correct output directory
- Try rebuilding: `bun run build`
- Clear browser extension cache

### Hot Reload Not Working
- Some changes require manual reload
- Try refreshing the page or reloading the extension

## 📚 Resources

- WXT Documentation: https://wxt.dev/
- Svelte 5 Docs: https://svelte.dev/
- OpenRouter API: https://openrouter.ai/docs
