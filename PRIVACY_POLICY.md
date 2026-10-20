# Privacy Policy for SafeTyper

**Last Updated: October 20, 2026**

## Overview

SafeTyper is a browser extension that checks grammar and spelling, and translates text, with an AI provider you choose. coolLabs, the maker of SafeTyper, does not receive that text. We do not run a server that your checks or translations are sent to.

## When text leaves your browser

Text is sent only to the provider selected in SafeTyper, and only when you run a grammar check or click Translate. Typing in a page, or typing in the Translate box, does not send that text anywhere. Text you do not submit is not sent.

Translate uses the same provider as grammar checks. It does not use a separate translation service. A local Ollama address keeps the translated text on your machine, the same way a grammar check does.

The providers in this version are:

- **OpenRouter.** The text and your OpenRouter API key are sent to OpenRouter (`https://openrouter.ai`). See [OpenRouter's privacy policy](https://openrouter.ai/privacy).
- **Groq.** The text and your Groq API key are sent to Groq (`https://api.groq.com`). See [Groq's privacy policy](https://groq.com/privacy-policy).
- **Ollama, on your machine.** Checks go to the base URL you set, at that server's `/v1/chat/completions` path. The default is `http://localhost:11434`. When that address is on your computer, the text stays on your machine. If you change the URL to another host, the text is sent to that host instead. SafeTyper does not add its own hop in between.

This version does not have a separate provider for other local OpenAI-compatible servers (for example LM Studio). The Ollama setting lists models with Ollama's `/api/tags` endpoint. A different local server will not work as a supported provider unless it speaks that Ollama API as well as the chat endpoint above.

A check result may be kept in memory for a few minutes so the same passage is not sent again. That cache is not written to disk and disappears when the page or the extension's background script is discarded.

## What is stored on your device

SafeTyper stores settings in the browser's extension storage (`browser.storage.local`):

- the provider you selected
- your OpenRouter and Groq API keys
- the Ollama base URL and selected models
- an optional custom system prompt
- light or dark theme
- whether you finished onboarding
- which popup tab you last opened
- your Translate source and target languages
- the last text you typed into Translate, the last translation, the detected source language, and any alternative wordings the model returned

API keys are sent only to the matching provider, as the `Authorization` header. They are not sent to coolLabs. Extension storage is removed when you uninstall SafeTyper.

SafeTyper does not store the text of the pages you visit. It does not use analytics or tracking. It does not sell data.

## Permissions

- **Host access (`<all_urls>`, plus `https://openrouter.ai/*` and `https://api.groq.com/*`).** The extension icon needs to appear on sites where you type, and checks need to reach the provider you chose, including a local Ollama address. SafeTyper reads a field when you check it. It does not collect browsing history.
- **`storage`.** Saves the settings and API keys listed above, on this device.
- **`scripting` and `tabs`.** Used to register the content script and to open extension pages such as onboarding.

## Planned features

The items in this section are not in the current release. None of this behavior happens until a version that includes the feature ships. They are described here so the intended data flow is public before that.

### Optional SafeTyper subscription

A paid SafeTyper provider may be added later. It will be off unless you select it. Choosing OpenRouter, Groq, or Ollama will not require an account.

When you select that provider and run a check or a translation, the text will be sent to a SafeTyper server, which forwards it to an upstream AI provider. SafeTyper will not log or store that text. The account email and billing details for the subscription will be handled by Stripe. Stripe's own privacy policy covers that payment data.

### In-extension editor

A writing page inside the extension may store documents in IndexedDB in your browser profile. Those documents stay in that profile. They are not synced to coolLabs, and they are not put in the browser's sync storage. Uninstalling the extension removes them. A check you run in the editor sends text only to the provider you selected, under the same rules as a check on a web page.

## Changes to this policy

We may update this policy. The date above changes when we do.

## Contact

Questions: open an issue on the [SafeTyper repository](https://github.com/coollabsio/safetyper).
