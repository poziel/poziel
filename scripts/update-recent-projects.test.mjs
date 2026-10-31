import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchLogo, fetchRepositories, renderCard, selectProjects, updateReadme } from './update-recent-projects.mjs';

const repo = (name, overrides = {}) => ({
  name, owner: { login: 'poziel' }, private: false, fork: false, archived: false,
  pushed_at: '2026-10-20T00:00:00Z', size: 1, description: 'A project.', ...overrides,
});
const projects = ['one', 'two', 'three', 'four', 'five'].map(name => repo(name));

test('selects five latest public owned projects and excludes ineligible repositories', () => {
  const candidates = [
    ...projects, repo('newest', { pushed_at: '2026-10-30T00:00:00Z' }),
    repo('private', { private: true }), repo('fork', { fork: true }),
    repo('archived', { archived: true }), repo('poziel'), repo('empty', { size: 0 }),
    repo('other-owner', { owner: { login: 'someone-else' } }),
  ];
  const selected = selectProjects(candidates);
  assert.equal(selected.length, 5);
  assert.equal(selected[0].name, 'newest');
  assert.ok(selected.slice(1).every(item => projects.some(project => project.name === item.name)));
});

test('preserves manual text and CRLF, escapes descriptions, and is idempotent', () => {
  const original = 'Manual intro\r\n<!-- RECENT-PROJECTS:START -->\r\nOld list\r\n<!-- RECENT-PROJECTS:END -->\r\nManual footer';
  const input = projects.map(item => ({ ...item }));
  input[0].description = 'A <tag> with [brackets]\nand *stars*';
  const updated = updateReadme(original, input);
  assert.ok(updated.startsWith('Manual intro\r\n'));
  assert.ok(updated.endsWith('\r\nManual footer'));
  assert.ok(updated.includes('A &lt;tag&gt; with [brackets] and *stars*'));
  assert.equal(updated.match(/<picture>/g).length, 5);
  assert.equal(updateReadme(updated, input), updated);
  assert.ok(!updated.replaceAll('\r\n', '').includes('\n'));
});

test('links theme-aware cards and exposes full original descriptions as hover and alt text', () => {
  const input = [repo('frame', { description: 'Original "description" & <text>' }), ...projects.slice(1)];
  const updated = updateReadme('<!-- RECENT-PROJECTS:START --><!-- RECENT-PROJECTS:END -->', input);
  assert.ok(updated.includes('href="https://github.com/poziel/frame" title="Original &quot;description&quot; &amp; &lt;text&gt;"'));
  assert.ok(updated.includes('srcset="assets/recent-projects/frame-dark.svg"'));
  assert.ok(updated.includes('src="assets/recent-projects/frame-light.svg"'));
  assert.ok(updated.includes('alt="Frame — Original &quot;description&quot; &amp; &lt;text&gt;"'));
  assert.ok(!updated.includes('undefined'));
  assert.ok(!updated.includes('style='));
});

test('cards have identical geometry, square logos, and one ellipsized description line', () => {
  const description = 'A long description with <markup> & details. '.repeat(6);
  const svg = renderCard(repo('frame', { description }), 'data:image/png;base64,eA==');
  assert.ok(svg.includes('width="1000" height="96" viewBox="0 0 1000 96"'));
  assert.ok(svg.includes('width="64" height="64" preserveAspectRatio="xMidYMid meet"'));
  assert.ok(svg.includes(`<desc id="description">${description.trim().replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('& details', '&amp; details')}</desc>`));
  const line = svg.match(/<text x="108" y="68"[^>]*>(.*?)<\/text>/)[1];
  assert.ok(line.endsWith('…'));
  assert.ok(!line.includes('\n'));
  assert.ok(renderCard(repo('frame'), null).includes('>A project.</text>'));
  assert.ok(renderCard(repo('frame'), null, true).includes('#58a6ff'));
});

test('fetches and embeds logos without external image dependencies', async () => {
  let requested;
  const data = await fetchLogo(repo('frame', { default_branch: 'release/one' }), async url => {
    if (url.includes('api.github.com')) return { ok: true, json: async () => [] };
    requested = url;
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('<svg/>') };
  });
  assert.ok(requested.includes('/release%2Fone/assets/frame.svg'));
  assert.equal(data, 'data:image/svg+xml;base64,PHN2Zy8+');
  assert.equal(await fetchLogo(repo('unknown'), async () => ({ ok: true, json: async () => [] })), null);
  await assert.rejects(fetchLogo(repo('frame'), async () => ({ ok: false, status: 403 })), /403/);
});

const file = path => ({ type: 'file', name: path.split('/').at(-1), path });
function logoFetch(rootFiles, assetFiles = [], { missing = [], error = null } = {}) {
  const downloads = [];
  return {
    downloads,
    fetch: async url => {
      if (url.includes('api.github.com')) {
        const inAssets = url.includes('/contents/Assets?');
        const entries = inAssets ? assetFiles.map(file) : [
          ...rootFiles.map(file),
          ...(assetFiles.length ? [{ type: 'dir', name: 'Assets', path: 'Assets' }] : []),
        ];
        return { ok: true, json: async () => entries };
      }
      const path = decodeURIComponent(new URL(url).pathname.split('/main/')[1]);
      downloads.push(path);
      if (missing.includes(path)) return { ok: false, status: 404 };
      if (error) return { ok: false, status: error };
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(path) };
    },
  };
}

test('discovers both names and formats in either directory, ignoring capitalization', async () => {
  for (const directory of ['', 'Assets/']) {
    for (const name of ['LoGo', 'PiXeN']) {
      for (const extension of ['SVG', 'PNG']) {
        const path = `${directory}${name}.${extension}`;
        const mock = logoFetch(directory ? [] : [path], directory ? [path] : []);
        const result = await fetchLogo(repo('pixen'), mock.fetch);
        assert.deepEqual(mock.downloads, [path]);
        assert.ok(result.startsWith(extension === 'SVG' ? 'data:image/svg+xml;' : 'data:image/png;'));
      }
    }
  }
});

test('SVG always wins over PNG, then root wins over assets and logo over project name', async () => {
  const scenarios = [
    { root: ['logo.png'], assets: ['Assets/pixen.svg'], winner: 'Assets/pixen.svg' },
    { root: ['logo.svg', 'pixen.svg'], assets: ['Assets/logo.svg'], winner: 'logo.svg' },
    { root: ['pixen.svg'], assets: ['Assets/logo.svg'], winner: 'pixen.svg' },
    { root: [], assets: ['Assets/logo.svg', 'Assets/pixen.svg'], winner: 'Assets/logo.svg' },
    { root: ['logo.png', 'pixen.png'], assets: ['Assets/logo.png'], winner: 'logo.png' },
    { root: ['logo.svg'], assets: ['Assets/frame.svg'], winner: 'logo.svg' },
  ];
  for (const scenario of scenarios) {
    const mock = logoFetch(scenario.root, scenario.assets);
    await fetchLogo(repo('pixen'), mock.fetch);
    assert.deepEqual(mock.downloads, [scenario.winner]);
  }
});

test('keeps custom paths as fallbacks, skips missing files, and propagates server errors', async () => {
  const custom = logoFetch([]);
  await fetchLogo(repo('reflet'), custom.fetch);
  assert.deepEqual(custom.downloads, ['icons/reflet.svg']);
  const missing = logoFetch(['logo.svg', 'logo.png'], [], { missing: ['logo.svg'] });
  const result = await fetchLogo(repo('new-project'), missing.fetch);
  assert.deepEqual(missing.downloads, ['logo.svg', 'logo.png']);
  assert.ok(result.startsWith('data:image/png;'));
  const failure = logoFetch(['logo.svg', 'logo.png'], [], { error: 503 });
  await assert.rejects(fetchLogo(repo('new-project'), failure.fetch), /503/);
  assert.deepEqual(failure.downloads, ['logo.svg']);
  assert.equal(await fetchLogo(repo('new-project'), async () => ({ ok: false, status: 404 })), null);
});

test('rejects missing, reversed, or duplicated markers and incomplete results', () => {
  for (const content of ['', '<!-- RECENT-PROJECTS:END --><!-- RECENT-PROJECTS:START -->',
    '<!-- RECENT-PROJECTS:START --><!-- RECENT-PROJECTS:END --><!-- RECENT-PROJECTS:START -->']) {
    assert.throws(() => updateReadme(content, projects), /markers/);
  }
  assert.throws(() => updateReadme('', projects.slice(1)), /five/);
});

test('fetches subsequent pages and fails on API errors', async () => {
  const urls = [];
  const all = await fetchRepositories(async url => {
    urls.push(url);
    return { ok: true, json: async () => urls.length === 1 ? Array(100).fill(repo('project')) : [repo('last')] };
  });
  assert.equal(all.length, 101);
  assert.ok(urls[1].endsWith('page=2'));
  await assert.rejects(fetchRepositories(async () => ({ ok: false, status: 403 })), /403/);
});
