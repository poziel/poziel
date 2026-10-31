import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const owner = 'poziel';
const startMarker = '<!-- RECENT-PROJECTS:START -->';
const endMarker = '<!-- RECENT-PROJECTS:END -->';

// Display names and fallback paths for existing projects with other structures.
// Standard root/assets logo names are discovered automatically, ignoring case.
const branding = {
  frame: { title: 'Frame', logo: 'assets/frame.svg' },
  'frame-server': { title: 'Frame Server', logo: 'assets/frame.svg' },
  pixen: { title: 'Pixen', logo: 'assets/pixen.png' },
  'pozieldotcom-lite': { title: 'poziel.com', logo: 'public/brand/poziel-mark.svg' },
  reflet: { title: 'Reflet', logo: 'icons/reflet.svg' },
};

export function selectProjects(repositories) {
  return repositories
    .filter(repo => repo.owner?.login?.toLowerCase() === owner
      && repo.private === false && !repo.fork && !repo.archived
      && repo.name.toLowerCase() !== owner && repo.pushed_at && repo.size > 0)
    .sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at)
      || a.name.localeCompare(b.name))
    .slice(0, 5);
}

function escapeHtml(value) {
  return value.replace(/\s+/g, ' ').trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderCard(repo, logoData, dark = false) {
  const title = branding[repo.name]?.title ?? repo.name;
  const description = (repo.description ?? '').replace(/\s+/g, ' ').trim();
  // Monospace keeps the single description line within a predictable width.
  const characters = Array.from(description);
  const summary = characters.length > 88 ? `${characters.slice(0, 87).join('').trimEnd()}…` : description;
  const colors = dark
    ? { border: '#30363d', title: '#58a6ff', text: '#adbac7' }
    : { border: '#d0d7de', title: '#0969da', text: '#57606a' };
  const icon = logoData
    ? `<image href="${logoData}" x="16" y="16" width="64" height="64" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="48" y="59" text-anchor="middle" fill="${colors.title}" font-family="monospace" font-size="32">${escapeHtml(title.slice(0, 1))}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="96" viewBox="0 0 1000 96" role="img" aria-labelledby="title description">
  <title id="title">${escapeHtml(title)}</title>
  <desc id="description">${escapeHtml(description)}</desc>
  <rect x="0.5" y="0.5" width="999" height="95" rx="4" fill="none" stroke="${colors.border}"/>
  <line x1="96" y1="1" x2="96" y2="95" stroke="${colors.border}"/>
  ${icon}
  <text x="108" y="34" fill="${colors.title}" font-family="Arial, sans-serif" font-size="19" font-weight="600">${escapeHtml(title)}</text>
  <text x="108" y="68" fill="${colors.text}" font-family="monospace" font-size="16">${escapeHtml(summary)}</text>
</svg>
`;
}

export async function fetchLogo(repo, fetchImpl = fetch) {
  const repository = `${owner}/${encodeURIComponent(repo.name)}`;
  const branch = encodeURIComponent(repo.default_branch ?? 'main');
  const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
  async function listDirectory(path) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/contents/${encodePath(path)}?ref=${branch}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'poziel-profile-readme' },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`Logo directory request failed for ${repo.name}: ${response.status}`);
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error(`Unexpected logo directory response for ${repo.name}`);
    return entries;
  }
  const root = await listDirectory('');
  const assetsPath = root.find(entry => entry.type === 'dir' && entry.name.toLowerCase() === 'assets')?.path;
  const assets = assetsPath ? await listDirectory(assetsPath) : [];
  const candidates = [];
  // Format wins over location and naming: every SVG precedes every PNG.
  for (const extension of ['svg', 'png']) {
    for (const entries of [root, assets]) {
      for (const name of ['logo', repo.name.toLowerCase()]) {
        const entry = entries.find(entry => entry.type === 'file'
          && entry.name.toLowerCase() === `${name}.${extension}`);
        if (entry) candidates.push(entry.path);
      }
    }
    const fallback = branding[repo.name]?.logo;
    if (fallback?.toLowerCase().endsWith(`.${extension}`)) candidates.push(fallback);
  }
  for (const logo of new Set(candidates)) {
    const url = `https://raw.githubusercontent.com/${repository}/${branch}/${encodePath(logo)}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`Logo request failed for ${repo.name}: ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer()).toString('base64');
    return `data:${logo.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png'};base64,${data}`;
  }
  return null;
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
    const title = escapeHtml(branding[repo.name]?.title ?? repo.name);
    const description = escapeHtml(repo.description ?? '');
    const asset = `assets/recent-projects/${encodeURIComponent(repo.name)}`;
    return [
      `<a href="${link}" title="${description}">`,
      '  <picture>',
      `    <source media="(prefers-color-scheme: dark)" srcset="${asset}-dark.svg">`,
      `    <img src="${asset}-light.svg" width="1000" alt="${title} — ${description}">`,
      '  </picture>',
      '</a>',
    ].join(newline);
  });
  return readme.slice(0, start + startMarker.length)
    + newline + newline + lines.join(newline + newline) + newline + newline + readme.slice(end);
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
  // Fetch all logos before writing, so a failed request leaves the old cards intact.
  const logos = await Promise.all(projects.map(repo => fetchLogo(repo)));
  await mkdir(new URL('../assets/recent-projects/', import.meta.url), { recursive: true });
  for (const [index, repo] of projects.entries()) {
    for (const dark of [false, true]) {
      const assetPath = new URL(`../assets/recent-projects/${encodeURIComponent(repo.name)}-${dark ? 'dark' : 'light'}.svg`, import.meta.url);
      await writeFile(assetPath, renderCard(repo, logos[index], dark));
    }
  }
  if (after !== before) await writeFile(path, after);
  console.log(`${after === before ? 'Already current' : 'Updated'}: ${projects.map(repo => repo.name).join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
