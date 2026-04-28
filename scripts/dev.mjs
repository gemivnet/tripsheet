#!/usr/bin/env node
// Local dev runner — spawns the API watcher and the web bundle watcher
// side-by-side with prefixed, color-coded output. Ctrl-C tears both down.
//
// Runs `yarn init:local` first to make sure .env + config.yaml exist.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const COLORS = {
  reset: '\x1b[0m',
  api: '\x1b[38;5;209m', // terracotta
  web: '\x1b[38;5;109m', // sage
  info: '\x1b[38;5;245m',
};

function log(tag, color, line) {
  if (!line) return;
  process.stdout.write(`${color}[${tag}]${COLORS.reset} ${line}\n`);
}

if (!existsSync(join(root, '.env')) || !existsSync(join(root, 'config.yaml'))) {
  log('dev', COLORS.info, 'First-run setup: generating .env and config.yaml…');
  const init = spawn('node', ['scripts/init.mjs'], { cwd: root, stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    init.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`init exited ${code}`))));
  });
}

const procs = [
  { tag: 'api', color: COLORS.api, cmd: 'yarn', args: ['tsx', 'watch', 'src/entrypoint.ts'] },
  { tag: 'web', color: COLORS.web, cmd: 'node', args: ['web/build.mjs', '--watch'] },
];

const children = procs.map(({ tag, color, cmd, args }) => {
  const child = spawn(cmd, args, { cwd: root, env: process.env });
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) log(tag, color, line);
    });
    stream.on('end', () => {
      if (buf) log(tag, color, buf);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    log(tag, color, `exited with code ${code}`);
    // If one side dies, bring the whole thing down so the user doesn't miss it.
    shutdown(code ?? 1);
  });
  return child;
});

function shutdown(code = 0) {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 200).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
