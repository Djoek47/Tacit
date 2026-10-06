import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@intermenu/aiuic-mcp': fileURLToPath(new URL('../mcp/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-adapters': fileURLToPath(new URL('../adapters/src/index.ts', import.meta.url)),
      '@intermenu/sdk': fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-notify': fileURLToPath(new URL('../notify/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-settings': fileURLToPath(new URL('../settings/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-resolve': fileURLToPath(new URL('../resolve/src/index.ts', import.meta.url)),
      '@intermenu/hepta': fileURLToPath(new URL('../hepta/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-present': fileURLToPath(new URL('../present/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-devtools': fileURLToPath(new URL('../devtools/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-eui': fileURLToPath(new URL('../eui/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-menu': fileURLToPath(new URL('../menu/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-kit': fileURLToPath(new URL('../kit/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-memory': fileURLToPath(new URL('../memory/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-pyramid': fileURLToPath(new URL('../pyramid/src/index.ts', import.meta.url)),
    },
  },
});
