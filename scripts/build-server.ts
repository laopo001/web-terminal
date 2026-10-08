import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('dist-server', { recursive: true, force: true });
await build({
  entryPoints: ['src/cli.ts'], outdir: 'dist-server', splitting: true,
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  packages: 'external', logLevel: 'info',
});
