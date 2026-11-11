import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const remote = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim();
const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(remote);
if (!match) throw new Error('Expected an HTTPS GitHub origin.');
const [, owner, repository] = match;

// Reuse the configured Git credential helper. Credentials stay in memory and are never logged.
const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'credential', 'fill'], {
  cwd: root, input: `protocol=https\nhost=github.com\npath=${owner}/${repository}.git\n\n`, encoding: 'utf8',
});
if (result.status !== 0) throw new Error('GitHub credential helper could not authenticate. Configure Pages in the repository Settings → Pages instead.');
const credential = Object.fromEntries(result.stdout.trim().split(/\r?\n/).map(line => {
  const equals = line.indexOf('='); return [line.slice(0, equals), line.slice(equals + 1)];
}));
if (!credential.password) throw new Error('No GitHub credential available.');
const url = `https://api.github.com/repos/${owner}/${repository}/pages`;
const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${credential.password}`, 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'lobby-pages-deploy', 'Content-Type': 'application/json' };
const response = await fetch(url, { headers });
const current = await response.json();
if (response.ok && current.build_type === 'legacy' && current.source?.branch === 'gh-pages' && current.source?.path === '/') {
  console.log(`Pages is already configured: ${current.html_url}`);
} else {
  if (!response.ok && response.status !== 404) throw new Error(`Could not inspect Pages settings (${response.status}). Configure it in GitHub Settings → Pages.`);
  const changed = await fetch(url, { method: response.ok ? 'PUT' : 'POST', headers, body: JSON.stringify({ build_type: 'legacy', source: { branch: 'gh-pages', path: '/' } }) });
  if (!changed.ok) {
    const error = await changed.json();
    throw new Error(`Pages configuration failed (${changed.status}): ${error.message ?? 'Use GitHub Settings → Pages'}`);
  }
  console.log(`Pages configured: gh-pages / (root). Site: https://${owner}.github.io/${repository}/`);
}
