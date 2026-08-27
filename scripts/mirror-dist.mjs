/**
 * Copy apps/web/dist to <repo-root>/dist.
 *
 * Vercel resolves the output directory from the project's Root Directory
 * setting, and which of the two candidate paths it checks depends on how the
 * project was imported. Rather than guess, publish the build to both:
 *
 *   apps/web/dist    natural Vite output, used when Root Directory = apps/web
 *   dist             repo root, used when Root Directory = the repo root
 *
 * Both are gitignored; the duplication only exists in a build artefact.
 */
import { cp, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const from = `${root}apps/web/dist`;
const to = `${root}dist`;

try {
  await stat(from);
} catch {
  console.error(`mirror-dist: nothing at ${from} — did the build run?`);
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await cp(from, to, { recursive: true });
console.log(`mirror-dist: apps/web/dist -> dist`);
