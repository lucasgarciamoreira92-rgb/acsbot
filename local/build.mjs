import { build as buildAPI } from 'esbuild';
import { build as buildClient } from 'vite';
import { mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
process.chdir(project);
const output = path.join(project, '.acs-local/build');
await mkdir(output, { recursive: true, mode: 0o700 });
const hash = createHash('sha256');
async function fingerprint(relative) {
  const absolute = path.join(project, relative);
  let children;
  try { children = await readdir(absolute, { withFileTypes: true }); }
  catch (error) {
    if (error.code !== 'ENOTDIR') throw error;
    hash.update(relative).update(await readFile(absolute));
    return;
  }
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
    if (child.isFile() || child.isDirectory()) await fingerprint(path.join(relative, child.name));
  }
}
for (const input of ['app', 'lib', 'components', 'hooks', 'local', 'public', 'vendor', 'package-lock.json', 'postcss.config.mjs', 'tsconfig.json']) await fingerprint(input);
const signature = hash.digest('hex');
try {
  if ((await readFile(path.join(output, 'signature'), 'utf8')) === signature) {
    await access(path.join(output, 'client/index.html'));
    await access(path.join(output, 'server/state.mjs'));
    console.log('Plataforma local pronta.');
    process.exit(0);
  }
} catch { /* First build, interrupted build or updated source. */ }
console.log('Preparando a plataforma para este computador…');
await buildAPI({
  entryPoints: { state: 'app/api/state/route.ts', jobs: 'app/api/jobs/route.ts', results: 'app/api/results/route.ts' },
  outdir: path.join(output, 'server'), outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', splitting: true, target: 'node22', logLevel: 'warning',
  plugins: [{ name: 'acs-local-bindings', setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'bindings', namespace: 'acs-local' }));
    builder.onLoad({ filter: /.*/, namespace: 'acs-local' }, () => ({ contents: 'export const env = globalThis.__acsLocalBindings;', loader: 'js' }));
  } }],
});
await buildClient({ configFile: path.join(project, 'local/vite.config.mjs'), logLevel: 'warn' });
await writeFile(path.join(output, 'signature'), signature, { mode: 0o600 });
console.log('Plataforma local preparada.');
