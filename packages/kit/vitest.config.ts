import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@intermenu/aiuic-menu': fileURLToPath(new URL('../menu/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-resolve': fileURLToPath(new URL('../resolve/src/index.ts', import.meta.url)),
      '@intermenu/hepta': fileURLToPath(new URL('../hepta/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-present': fileURLToPath(new URL('../present/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-devtools': fileURLToPath(new URL('../devtools/src/index.ts', import.meta.url)),
      '@intermenu/aiuic-eui': fileURLToPath(new URL('../eui/src/index.ts', import.meta.url)),
    },
  },
});
