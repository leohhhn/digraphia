import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Build to <repo-root>/dist rather than apps/web/dist. Vercel resolves the
// output directory from the project root, and its Vite preset defaults to
// "dist" there - emitting straight to that path means the deployment works
// whether or not vercel.json's outputDirectory is honoured.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  server: { port: 5173 },
  build: {
    target: 'es2022',
    outDir: `${repoRoot}dist`,
    emptyOutDir: true,
  },
});
