import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const owner = 'poziel';
const startMarker = '<!-- RECENT-PROJECTS:START -->';
const endMarker = '<!-- RECENT-PROJECTS:END -->';

export function selectProjects(repositories) {
  return repositories
    .filter(repo => repo.owner?.login?.toLowerCase() === owner
      && repo.private === false && !repo.fork && !repo.archived
      && repo.name.toLowerCase() !== owner && repo.pushed_at && repo.size > 0)
    .sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at)
      || a.name.localeCompare(b.name))
    .slice(0, 5);
}

function escapeMarkdown(value) {
  return value.replace(/\s+/g, ' ').trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()!|]/g, '\\$&');
}

export function updateReadme(readme, projects) {
  if (projects.length !== 5) throw new Error('Expected five public projects; README left unchanged.');
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);
  if (start < 0 || end < start || readme.indexOf(startMarker, start + 1) !== -1
    || readme.indexOf(endMarker, end + 1) !== -1) {
    throw new Error('Expected exactly one ordered pair of recent-project markers.');
  }
  const newline = readme.includes('\r\n') ? '\r\n' : '\n';
  const lines = projects.map(repo => {
    const link = `https://github.com/${owner}/${encodeURIComponent(repo.name)}`;
    const description = repo.description ? ` — ${escapeMarkdown(repo.description)}` : '';
    return `- [${escapeMarkdown(repo.name)}](${link})${description}`;
  });
  return readme.slice(0, start + startMarker.length)
    + newline + lines.join(newline) + newline + readme.slice(end);
}

export async function fetchRepositories(fetchImpl = fetch) {
  const repositories = [];
  for (let page = 1; ; page++) {
    // This endpoint only exposes public repositories; no personal token is needed.
    const response = await fetchImpl(`https://api.github.com/users/${owner}/repos?type=owner&sort=pushed&direction=desc&per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'poziel-profile-readme' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub API request failed: ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Unexpected GitHub API response.');
    repositories.push(...batch);
    if (batch.length < 100) return repositories;
  }
}

async function main() {
  const path = new URL('../README.md', import.meta.url);
  const projects = selectProjects(await fetchRepositories());
  const before = await readFile(path, 'utf8');
  const after = updateReadme(before, projects);
  if (after !== before) await writeFile(path, after);
  console.log(`${after === before ? 'Already current' : 'Updated'}: ${projects.map(repo => repo.name).join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
