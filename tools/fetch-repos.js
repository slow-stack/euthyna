// Batch-fetch GitHub repo metadata + README head through the local proxy CONNECT tunnel.
const http = require('http');
const https = require('https');

const PROXY = { host: '127.0.0.1', port: 7897 };
const REPOS = process.argv.slice(2);

function get(target, path) {
  return new Promise((resolve, reject) => {
    const cr = http.request({
      host: PROXY.host,
      port: PROXY.port,
      method: 'CONNECT',
      path: `${target}:443`,
      headers: { host: `${target}:443` },
    });
    cr.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`CONNECT ${res.statusCode}`));
      const r = https.request(
        { socket, agent: false, servername: target, path, method: 'GET',
          headers: { host: target, 'user-agent': 'dsh-research', accept: 'application/vnd.github+json' } },
        (resp) => {
          const chunks = [];
          resp.on('data', (c) => chunks.push(c));
          resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        }
      );
      r.on('error', reject);
      r.end();
    });
    cr.on('error', reject);
    cr.end();
  });
}

(async () => {
  for (const repo of REPOS) {
    console.log(`\n########## ${repo}`);
    try {
      const meta = await get('api.github.com', `/repos/${repo}`);
      if (meta.status !== 200) {
        console.log(`  meta HTTP ${meta.status}`);
      } else {
        const m = JSON.parse(meta.body);
        console.log(`  stars=${m.stargazers_count} forks=${m.forks_count} issues=${m.open_issues_count} pushed=${m.pushed_at} created=${m.created_at}`);
        console.log(`  license=${m.license && m.license.spdx_id} archived=${m.archived}`);
        console.log(`  desc: ${m.description || '-'}`);
      }
      const rd = await get('api.github.com', `/repos/${repo}/readme`);
      if (rd.status !== 200) {
        console.log(`  readme HTTP ${rd.status}`);
      } else {
        const j = JSON.parse(rd.body);
        const text = Buffer.from(j.content, 'base64').toString('utf8');
        console.log('  --- README head (2400 chars) ---');
        console.log(text.slice(0, 2400).split('\n').map((l) => '  | ' + l).join('\n'));
      }
    } catch (e) {
      console.log(`  ERROR ${e.message}`);
    }
  }
})();
