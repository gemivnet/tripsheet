import { build, context } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const isWatch = process.argv.includes('--watch');

const options = {
  entryPoints: ['web/src/index.tsx'],
  bundle: true,
  outfile: 'web/dist/app.js',
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  minify: !isWatch,
  sourcemap: isWatch,
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
};

// Copy static files
mkdirSync('web/dist', { recursive: true });
cpSync('web/public/index.html', 'web/dist/index.html');
cpSync('web/src/styles.css', 'web/dist/styles.css');

// Server-side non-TS assets. tsc emits only .js, so without these the built image
// throws ENOENT before main() is reached: src/ai/{parsePdf,chat,suggest}.ts read their
// prompt at import time, and migrate() reads the migrations directory.
cpSync('src/prompts', 'dist/prompts', { recursive: true });
cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });

if (isWatch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[esbuild] Watching for changes...');
} else {
  await build(options);
  console.log('[esbuild] Build complete.');
}
