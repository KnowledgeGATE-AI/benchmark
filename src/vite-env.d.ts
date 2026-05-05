/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENROUTER_SITE_URL?: string;
  readonly VITE_OPENROUTER_APP_TITLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
