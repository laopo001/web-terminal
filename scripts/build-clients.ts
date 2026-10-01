import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('dist-clients', { recursive: true });
for (const target of ['vscode', 'electron']) {
  const output = `dist-clients/${target}`;
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const vscode = target === 'vscode';
  await build({
    entryPoints: [`targets/${target}/src/${vscode ? 'extension' : 'main'}.ts`],
    outfile: `${output}/${vscode ? 'extension' : 'main'}.cjs`,
    bundle: true, platform: 'node', format: 'cjs', target: 'node20',
    external: [vscode ? 'vscode' : 'electron'], logLevel: 'info',
  });
  const manifest = JSON.parse(await readFile(`targets/${target}/package.json`, 'utf8'));
  await writeFile(`${output}/package.json`, JSON.stringify({ ...manifest, version: root.version }, null, 2) + '\n');
  for (const item of ['media', 'README.md']) {
    const source = `targets/${target}/${item}`;
    if (existsSync(source)) await cp(source, `${output}/${item}`, { recursive: true });
  }
}
