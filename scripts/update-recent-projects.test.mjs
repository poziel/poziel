import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRepositories, selectProjects, updateReadme } from './update-recent-projects.mjs';

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
  assert.equal(updated.match(/<table width="100%">/g).length, 5);
  assert.equal(updateReadme(updated, input), updated);
  assert.ok(!updated.replaceAll('\r\n', '').includes('\n'));
});

test('renders existing logos, linked titles, and repository descriptions in cards', () => {
  const input = [repo('frame', { default_branch: 'release/one', description: 'Original "description" & <text>' }),
    ...projects.slice(1)];
  const updated = updateReadme('<!-- RECENT-PROJECTS:START --><!-- RECENT-PROJECTS:END -->', input);
  assert.ok(updated.includes('https://raw.githubusercontent.com/poziel/frame/release%2Fone/assets/frame.svg'));
  assert.ok(updated.includes('width="48" height="48" alt="Frame logo"'));
  assert.ok(updated.includes('<strong><a href="https://github.com/poziel/frame">Frame</a></strong><br>Original &quot;description&quot; &amp; &lt;text&gt;'));
  assert.ok(updated.includes('<strong>T</strong>'));
  assert.ok(!updated.includes('undefined'));
  assert.ok(!updated.includes('style='));
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
