/**
 * The Claude Code plugin surface: .claude-plugin/{plugin.json,marketplace.json}
 * make the repo installable via `/plugin marketplace add slow-stack/euthyna`.
 * Skills are referenced by path and take their invocation name from SKILL.md
 * frontmatter — a path rename or a version drift between the manifests is the
 * silent breakage this pins.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel) => readFile(path.join(ROOT, rel), 'utf8');

describe('the package is installable as a Claude Code plugin', () => {
  test('plugin.json references the shipped skill directories by their real paths', async () => {
    const manifest = JSON.parse(await read('.claude-plugin/plugin.json'));
    const pkg = JSON.parse(await read('package.json'));
    assert.equal(manifest.version, pkg.version, 'manifest version tracks the npm package');
    for (const skill of manifest.skills) {
      await access(path.join(ROOT, skill, 'SKILL.md'));
      const front = await readFile(path.join(ROOT, skill, 'SKILL.md'), 'utf8');
      assert.match(front, /^name: /m, `${skill} declares a stable invocation name`);
      const desc = front.match(/^description: (.*)$/m)?.[1] ?? '';
      if (!desc.startsWith("'") && !desc.startsWith('"')) {
        assert.ok(!desc.includes(': '), `${skill} description has a bare ": " — quote it or YAML parsers reject the file`);
      }
    }
  });

  test('marketplace.json points at the repo root and names the plugin', async () => {
    const market = JSON.parse(await read('.claude-plugin/marketplace.json'));
    assert.equal(market.plugins[0].source, '.');
    assert.equal(market.plugins[0].name, 'euthyna');
  });
});
