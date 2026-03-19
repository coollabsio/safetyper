import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: (env) => ({
    action: {
      default_popup: 'popup.html',
    },
    permissions: ['storage', 'scripting', 'tabs'],
    host_permissions: [
      'https://openrouter.ai/*',
      'https://api.groq.com/*',
      '<all_urls>'
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline';"
    },
    web_accessible_resources: [
      {
        resources: ['icon/*'],
        matches: ['<all_urls>'],
      },
    ],
    ...(env.browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: '{32e06eb9-ef89-4b9f-84e0-8413f42d070e}',
        },
      },
    }),
  }),
});
