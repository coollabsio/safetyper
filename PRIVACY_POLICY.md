# Privacy Policy for SafeTyper

**Last Updated: March 19, 2026**

## Overview

SafeTyper is a browser extension that checks grammar and spelling using AI language models via the OpenRouter API. We are committed to protecting your privacy.

## Data Collection

SafeTyper does **not** collect, store, or transmit any personal data to our servers. We do not operate any servers.

### What data is processed

- **Text you submit for grammar checking**: When you click "Check Grammar", the text in the active input field is sent to the OpenRouter API for processing. This text is sent directly from your browser to OpenRouter's servers.
- **API Key**: Your OpenRouter API key is stored locally in your browser's extension storage (`browser.storage.local`). It is never sent to any server other than OpenRouter for authentication purposes.
- **Selected model preference**: Your chosen AI model is stored locally in your browser's extension storage.

### What data is NOT collected

- We do not collect browsing history
- We do not collect personal information
- We do not use analytics or tracking
- We do not collect or store the text you type — only text explicitly submitted for grammar checking is processed
- We do not sell or share any data

## Third-Party Services

SafeTyper uses the **OpenRouter API** (https://openrouter.ai) to process grammar checks. When you submit text for checking, it is sent to OpenRouter's servers. Please review [OpenRouter's Privacy Policy](https://openrouter.ai/privacy) for details on how they handle data.

## Permissions

- **`<all_urls>` host permission**: Required so the grammar checking icon can appear on any website where you type text. SafeTyper only activates on text input fields and does not read or modify page content beyond the text you explicitly check.
- **`storage` permission**: Used to save your API key and model preference locally.
- **`activeTab` permission**: Used to interact with the current tab's input fields.

## Data Storage

All data is stored locally on your device using the browser's built-in extension storage API. No data is stored on external servers by SafeTyper.

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be reflected in the "Last Updated" date above.

## Contact

If you have questions about this privacy policy, please open an issue on our [GitHub repository](https://github.com/coollabsio/safetyper-next).
