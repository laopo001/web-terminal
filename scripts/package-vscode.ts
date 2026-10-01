import { createVSIX } from '@vscode/vsce';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('release', { recursive: true });
await createVSIX({ cwd: resolve('dist-clients/vscode'), packagePath: resolve('release/web-terminal.vsix'), dependencies: false, allowMissingRepository: true, skipLicense: true });
