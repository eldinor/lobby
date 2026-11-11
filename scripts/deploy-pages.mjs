import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { publish } from 'gh-pages';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = resolve(root, 'dist');
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8' }).trim();
const remote = git('remote', 'get-url', 'origin');
if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(remote)) throw new Error('Expected an HTTPS GitHub origin. Check the remote before publishing.');
const files = await readdir(dist);
if (!files.includes('index.html') || !files.includes('assets')) throw new Error('Build the app before deploying.');
for (const file of files) if (file.startsWith('.env') || file === 'supabase' || file === 'node_modules') throw new Error(`Unexpected build output: ${file}`);
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
if (/\b(?:src|href)="\/assets\//.test(html)) throw new Error('Build uses root asset URLs and would fail under /lobby/.');
await writeFile(resolve(dist, '.nojekyll'), '');

// Scope the ownership exception to this process and this checkout only.
const existing = Number(process.env.GIT_CONFIG_COUNT || 0);
process.env.GIT_CONFIG_COUNT = String(existing + 1);
process.env[`GIT_CONFIG_KEY_${existing}`] = 'safe.directory';
process.env[`GIT_CONFIG_VALUE_${existing}`] = root.replaceAll('\\', '/');
console.log(`Publishing dist/ to ${remote} (gh-pages)…`);
await new Promise((done, reject) => publish(dist, {
  branch: 'gh-pages', remote: 'origin', repo: remote, dotfiles: true,
  user: { name: git('config', 'user.name'), email: git('config', 'user.email') },
  message: `Deploy lobby build from ${git('rev-parse', '--short', 'HEAD')}`,
}, error => error ? reject(error) : done()));
console.log('Published the production build to gh-pages. Source branch unchanged.');
