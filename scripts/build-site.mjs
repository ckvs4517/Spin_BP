import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(projectRoot, 'dist');
if (!dist.startsWith(`${projectRoot}${sep}`)) throw new Error('Invalid build output path.');

const serverDir = join(dist, 'server');
const clientDir = join(dist, 'client');
const drizzleDir = join(dist, '.openai', 'drizzle');

await rm(dist, { recursive: true, force: true });
await Promise.all([
  mkdir(serverDir, { recursive: true }),
  mkdir(clientDir, { recursive: true }),
  mkdir(drizzleDir, { recursive: true }),
]);

const apiSource = await readFile(join(projectRoot, 'worker', 'src', 'index.js'), 'utf8');
const serverEntry = `import api from './api.js';\n\nexport default {\n  async fetch(request, env) {\n    const url = new URL(request.url);\n    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {\n      return api.fetch(request, env);\n    }\n    return env.ASSETS.fetch(request);\n  },\n};\n`;

await Promise.all([
  writeFile(join(serverDir, 'api.js'), apiSource, 'utf8'),
  writeFile(join(serverDir, 'index.js'), serverEntry, 'utf8'),
  (async () => { const html = await readFile(join(projectRoot, 'index.html'), 'utf8'); const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(); await writeFile(join(clientDir, 'index.html'), html.replaceAll('__COMMIT_SHA__', sha), 'utf8'); })(),
  cp(join(projectRoot, 'app.js'), join(clientDir, 'app.js')),
  cp(join(projectRoot, 'styles.css'), join(clientDir, 'styles.css')),
  cp(join(projectRoot, 'config.js'), join(clientDir, 'config.js')),
  cp(join(projectRoot, 'data'), join(clientDir, 'data'), { recursive: true }),
  cp(join(projectRoot, 'images'), join(clientDir, 'images'), { recursive: true }),
  cp(join(projectRoot, '.openai', 'hosting.json'), join(dist, '.openai', 'hosting.json')),
]);

const migrationNames = (await readdir(join(projectRoot, '.openai', 'drizzle')))
  .filter((name) => name.endsWith('.sql'));
await Promise.all(migrationNames.map((name) =>
  cp(join(projectRoot, '.openai', 'drizzle', name), join(drizzleDir, name))));

const requiredFiles = [
  [join(serverDir, 'index.js'), 100],
  [join(serverDir, 'api.js'), 1000],
  [join(clientDir, 'index.html'), 500],
  [join(clientDir, 'app.js'), 1000],
  [join(clientDir, 'styles.css'), 1000],
  [join(clientDir, 'config.js'), 50],
  [join(dist, '.openai', 'hosting.json'), 20],
];
for (const [path, minimumBytes] of requiredFiles) {
  const info = await stat(path);
  if (!info.isFile() || info.size < minimumBytes) throw new Error(`Invalid build artifact: ${path}`);
}

console.log(`Spin BP Sites build completed with ${migrationNames.length} migration(s).`);
