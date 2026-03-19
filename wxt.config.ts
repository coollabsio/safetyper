import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    action: {
      default_popup: 'popup.html',
    },
    permissions: ['storage', 'scripting', 'tabs'],
    host_permissions: [
      'https://openrouter.ai/*',
      '<all_urls>'
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline';"
    },
  },
});
