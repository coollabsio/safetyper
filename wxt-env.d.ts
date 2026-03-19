/// <reference types="svelte" />

interface ImportMetaEnv {
  readonly VITE_OPENROUTER_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
