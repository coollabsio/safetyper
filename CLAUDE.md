# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run dev` - Start development server (defaults to Chrome)
- `npm run dev:firefox` - Start development server for Firefox

### Build & Package
- `npm run build` - Build for Chrome
- `npm run build:firefox` - Build for Firefox
- `npm run zip` - Create distribution zip for Chrome
- `npm run zip:firefox` - Create distribution zip for Firefox

### Type Checking
- `npm run check` - Run Svelte type checking

## Architecture

This is a WXT browser extension project using Svelte 5. WXT is a modern framework for building browser extensions with hot-reload and TypeScript support.

### Project Structure
- `/src/entrypoints/` - Extension entry points
  - `background.ts` - Service worker/background script
  - `content.ts` - Content script injected into web pages (currently configured for Google domains)
  - `popup/` - Extension popup UI
    - `main.ts` - Popup entry point using Svelte 5's mount API
    - `App.svelte` - Root Svelte component
- `/src/lib/` - Shared Svelte components
- `/public/` - Static assets accessible to the extension
- `wxt.config.ts` - WXT configuration with Svelte module integration

### Key Technologies
- **WXT**: Framework handling extension build process, manifest generation, and hot-reload
- **Svelte 5**: Using the new mount API and runes syntax
- **TypeScript**: Full type checking with svelte-check

### Extension Development Notes
- Content scripts are defined with `defineContentScript()` and specify URL match patterns
- Background scripts use `defineBackground()` for service worker logic
- The `.wxt/` directory contains auto-generated files including the base TypeScript config
- Extension manifest is automatically generated from entrypoint configurations