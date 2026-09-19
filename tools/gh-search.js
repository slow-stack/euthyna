// Search GitHub repositories through the local proxy CONNECT tunnel.
const http = require('http');
const https = require('https');

const PROXY = { host: '127.0.0.1', port: 7897 };

function get(target, path) {
  return new Promise((resolve, reject) => {
    const cr = http.request({
      host: PROXY.host, port: PROXY.port, method: 'CONNECT',
      path: `${target}:443`, headers: { host: `${target}:443` },
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

const QUERIES = process.argv.slice(2);

(async () => {
  for (const q of QUERIES) {
    console.log(`\n########## QUERY: ${q}`);
    try {
      const res = await get('api.github.com', `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=15`);
      if (res.status !== 200) { console.log(`  HTTP ${res.status} ${res.body.slice(0, 200)}`); continue; }
      const j = JSON.parse(res.body);
      console.log(`  total=${j.total_count}`);
      for (const r of j.items) {
        console.log(`  - ${r.full_name} | ${r.stargazers_count}★ | push=${(r.pushed_at || '').slice(0, 10)} | ${r.license ? r.license.spdx_id : 'no-license'}`);
        console.log(`      ${(r.description || '').slice(0, 190)}`);
      }
    } catch (e) { console.log(`  ERROR ${e.message}`); }
  }
})();
