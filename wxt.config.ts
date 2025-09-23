import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    action: {
      default_popup: 'popup.html',
    },
    permissions: ['storage'],
    host_permissions: [
      'https://openrouter.ai/*'
    ],
  },
});
