// Fetch the third-party sources this project reads, on demand.
//
// Why this exists rather than a `reference/` directory checked into git:
//
//   1. Two of the upstreams are CC-BY-SA-4.0. Vendoring those files means the
//      repository ships CC-BY-SA material, which makes the project's own
//      licence ambiguous for anyone who wants to reuse it. A reference is not a
//      copy; keeping them out of the tree keeps the licence simple.
//   2. Reading upstream is a *reading* activity. It should not require the
//      reader to receive a snapshot that silently drifts from upstream.
//
// Usage:
//   node tools/fetch-references.js            # fetch everything
//   node tools/fetch-references.js tob        # fetch one source by slug
//   node tools/fetch-references.js --list     # show the manifest
//
// Files land in .refs/<slug>/, which is gitignored. Nothing here is executed;
// these are text files to read.
//
// Requires the local proxy on 127.0.0.1:7897 (see the pitfall table in AGENTS.md).

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PROXY = { host: '127.0.0.1', port: 7897 };

// Flattened names use `__` in place of `/`, matching how these were originally
// archived. The script converts back, so the manifest stays a plain list.
// An entry may also be `{ name, path }` when the local name differs from the
// upstream basename.
const SOURCES = [
  {
    slug: 'trail-of-bits',
    repo: 'trailofbits/skills',
    branch: 'main',
    license: 'CC-BY-SA-4.0',
    copyright: 'Copyright Trail of Bits',
    note: 'Read for methodology. Their licence explicitly permits reuse; this project credits them and does not relicense their text.',
    files: [
      { name: 'tob-readme.md', path: 'README.md' },
      'plugins__differential-review__agents__adversarial-modeler.md',
      'plugins__differential-review__commands__diff-review.md',
      'plugins__differential-review__README.md',
      'plugins__differential-review__skills__differential-review__adversarial.md',
      'plugins__differential-review__skills__differential-review__methodology.md',
      'plugins__differential-review__skills__differential-review__patterns.md',
      'plugins__differential-review__skills__differential-review__reporting.md',
      'plugins__differential-review__skills__differential-review__SKILL.md',
      'plugins__fp-check__agents__data-flow-analyzer.md',
      'plugins__fp-check__agents__exploitability-verifier.md',
      'plugins__fp-check__agents__poc-builder.md',
      'plugins__fp-check__hooks__hooks.json',
      'plugins__fp-check__README.md',
      'plugins__fp-check__skills__fp-check__references__bug-class-verification.md',
      'plugins__fp-check__skills__fp-check__references__deep-verification.md',
      'plugins__fp-check__skills__fp-check__references__evidence-templates.md',
      'plugins__fp-check__skills__fp-check__references__false-positive-patterns.md',
      'plugins__fp-check__skills__fp-check__references__gate-reviews.md',
      'plugins__fp-check__skills__fp-check__references__standard-verification.md',
      'plugins__fp-check__skills__fp-check__SKILL.md',
      'plugins__supply-chain-risk-auditor__evals__evals.json',
      'plugins__supply-chain-risk-auditor__README.md',
      'plugins__supply-chain-risk-auditor__skills__supply-chain-risk-auditor__scripts__pyproject.toml',
      'plugins__supply-chain-risk-auditor__skills__supply-chain-risk-auditor__SKILL.md'
    ]
  },
  {
    slug: 'competitors',
    repo: 'PerryLink/dsh-skill-pack-security',
    branch: 'main',
    license: 'Apache-2.0',
    copyright: 'dsh-skill-pack-security contributors',
    note: 'Read for competitive boundary analysis and as a provider-plugin skeleton: what the closest competitor covers, and what it does not.',
    files: [
      'skills__security-audit__SKILL.md',
      'skills__dependency-audit__SKILL.md',
      { name: 'provider-index.ts', path: 'provider/src/index.ts' },
      { name: 'provider-patch.yml', path: 'provider/cordis.patch.yml' },
      { name: 'provider-pkg.json', path: 'provider/package.json' }
    ]
  }
];

/** Accept either the flattened string form or an explicit {name, path}. */
function toTarget(entry) {
  if (typeof entry === 'string') {
    return { name: `${path.basename(entry)}`, upstream: entry.replace(/__/g, '/') };
  }
  return { name: entry.name, upstream: entry.path };
}

function get(target, requestPath) {
  return new Promise((resolve, reject) => {
    const connect = http.request({
      host: PROXY.host,
      port: PROXY.port,
      method: 'CONNECT',
      path: `${target}:443`,
      headers: { host: `${target}:443` }
    });
    connect.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`CONNECT ${res.statusCode}`));
      const req = https.request(
        {
          socket,
          agent: false,
          servername: target,
          path: requestPath,
          method: 'GET',
          headers: { host: target, 'user-agent': 'euthyna-fetch-references' }
        },
        (resp) => {
          const chunks = [];
          resp.on('data', (c) => chunks.push(c));
          resp.on('end', () =>
            resolve({ status: resp.statusCode, body: Buffer.concat(chunks) })
          );
        }
      );
      req.on('error', reject);
      req.end();
    });
    connect.on('error', reject);
    connect.setTimeout(30000, () => connect.destroy(new Error('connect timeout')));
    connect.end();
  });
}

async function fetchSource(source, outRoot) {
  const dir = path.join(outRoot, source.slug);
  fs.mkdirSync(dir, { recursive: true });

  let ok = 0;
  const failures = [];
  for (const entry of source.files) {
    const { name, upstream } = toTarget(entry);
    const dest = path.join(dir, name);
    try {
      const res = await get(
        'raw.githubusercontent.com',
        `/${source.repo}/${source.branch}/${upstream}`
      );
      if (res.status !== 200) {
        failures.push(`${upstream} -> HTTP ${res.status}`);
        continue;
      }
      fs.writeFileSync(dest, res.body);
      ok++;
    } catch (error) {
      failures.push(`${upstream} -> ${error.message}`);
    }
  }

  // Record provenance next to the files so a reader of a local checkout knows
  // what they are looking at, and under which terms, without consulting the repo.
  fs.writeFileSync(
    path.join(dir, 'PROVENANCE.txt'),
    [
      `source      : https://github.com/${source.repo}`,
      `branch      : ${source.branch}`,
      `license     : ${source.license}`,
      `copyright   : ${source.copyright}`,
      `fetched     : ${new Date().toISOString()}`,
      `files       : ${ok}/${source.files.length}`,
      '',
      source.note,
      '',
      'These files are the work of their authors, fetched for reading.',
      'They are not part of this project and are not covered by its licence.',
      ''
    ].join('\n'),
    'utf8'
  );

  return { ok, total: source.files.length, failures };
}

(async () => {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    for (const s of SOURCES) {
      console.log(`${s.slug}  (${s.files.length} files, ${s.license})`);
      console.log(`  https://github.com/${s.repo}`);
      for (const f of s.files) {
        const { name, upstream } = toTarget(f);
        console.log(`    ${name.padEnd(58)} <- ${upstream}`);
      }
    }
    return;
  }

  const wanted = args.filter((a) => !a.startsWith('--'));
  const selected = wanted.length
    ? SOURCES.filter((s) => wanted.includes(s.slug))
    : SOURCES;

  if (selected.length === 0) {
    console.error(`no source matches: ${wanted.join(', ')}`);
    console.error(`available: ${SOURCES.map((s) => s.slug).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const outRoot = path.join(__dirname, '..', '.refs');
  let failed = 0;

  for (const source of selected) {
    console.log(`\n${source.slug}  <- github.com/${source.repo}  (${source.license})`);
    const { ok, total, failures } = await fetchSource(source, outRoot);
    console.log(`  fetched ${ok}/${total} -> .refs/${source.slug}/`);
    for (const f of failures) console.log(`  FAILED ${f}`);
    failed += failures.length;
  }

  console.log(
    failed === 0
      ? '\nall files fetched. These are gitignored; nothing was added to the repository.'
      : `\n${failed} file(s) failed to fetch.`
  );
  process.exitCode = failed === 0 ? 0 : 1;
})();
