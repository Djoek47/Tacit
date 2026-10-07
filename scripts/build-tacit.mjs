// Builds the Tacit web app and its server. Works the same on Windows, macOS and Linux.
//   npm install          (once, at the repository root)
//   npm run tacit:build
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps', 'tacit');
const tsconfig = join(root, 'packages', 'tacit', 'tsconfig.json');

// 1. The page: Tacit's code, bundled into one script and inlined into one HTML file.
const page = await build({
  entryPoints: [join(app, 'entry.ts')], bundle: true, format: 'iife', globalName: 'Tacit',
  platform: 'browser', target: 'es2020', minify: true, legalComments: 'none', tsconfig, write: false, logLevel: 'warning',
});
const js = page.outputFiles[0].text;
const html = [readFileSync(join(app, 'head.html'), 'utf8'), readFileSync(join(app, 'body.html'), 'utf8'),
  '<script>\n', js, '\n</script>\n', readFileSync(join(app, 'app.js'), 'utf8')].join('');
writeFileSync(join(app, 'index.html'), html);
console.log(`page    apps/tacit/index.html   ${(html.length / 1024).toFixed(0)} KB`);

// 2. The server: one file that runs with plain `node`, no install needed.
await build({
  entryPoints: [join(app, 'server.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', tsconfig,
  outfile: join(app, 'server.mjs'), logLevel: 'warning', nodePaths: [join(root, 'packages', 'mcp', 'node_modules'), join(root, 'node_modules')],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});
console.log('server  apps/tacit/server.mjs   (run: npm run tacit)');
