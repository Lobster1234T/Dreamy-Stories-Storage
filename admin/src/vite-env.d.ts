/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "owner/repo" used on the login screen when the panel is not served from GitHub Pages. */
  readonly VITE_DEFAULT_REPO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
