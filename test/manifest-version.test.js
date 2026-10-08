/**
 * Every version-bearing manifest must carry the same version as package.json.
 *
 * Three surfaces publish from three different files: npm and the DSH bundle
 * read package.json, the Claude Code marketplace reads its two JSONs, Hermes
 * reads plugin.yaml. At 0.5.0 the three plugin manifests shipped a release
 * behind and needed a follow-up commit (ebe9800) — nothing failed, because
 * nothing compared them. The drift is invisible to a reader and to CI at the
 * same time, which is the category of defect this pins.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel) => readFile(path.join(ROOT, rel), 'utf8');

test('package.json, the Claude Code manifests and plugin.yaml all name one version', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const marketplace = JSON.parse(await read('.claude-plugin/marketplace.json'));
  const plugin = JSON.parse(await read('.claude-plugin/plugin.json'));
  const hermes = /^version:\s*(\S+)\s*$/m.exec(await read('plugin.yaml'))?.[1];

  assert.ok(pkg.version, 'package.json carries a version');
  const surfaces = {
    '.claude-plugin/marketplace.json (metadata.version)': marketplace.metadata?.version,
    '.claude-plugin/plugin.json': plugin.version,
    'plugin.yaml (hermes)': hermes
  };
  for (const [where, value] of Object.entries(surfaces)) {
    assert.equal(value, pkg.version, `${where} must equal package.json's ${pkg.version}, found ${value}`);
  }
});
