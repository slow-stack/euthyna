// Fetch npm package metadata for specific names through the proxy tunnel.
const http = require('http');
const https = require('https');

const PROXY = { host: '127.0.0.1', port: 7897 };
const NAMES = process.argv.slice(2);

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
          headers: { host: target, 'user-agent': 'dsh-research', accept: 'application/json' } },
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
  for (const n of NAMES) {
    console.log(`\n########## ${n}`);
    try {
      const res = await get('registry.npmjs.org', `/${encodeURIComponent(n)}`);
      if (res.status !== 200) { console.log(`  HTTP ${res.status}`); continue; }
      const j = JSON.parse(res.body);
      const latest = j['dist-tags'] && j['dist-tags'].latest;
      const v = j.versions && j.versions[latest];
      console.log(`  version    : ${latest}`);
      console.log(`  created    : ${(j.time && j.time.created || '').slice(0, 10)}   modified: ${(j.time && j.time.modified || '').slice(0, 10)}`);
      console.log(`  description: ${j.description || '-'}`);
      console.log(`  repo       : ${v && v.repository ? JSON.stringify(v.repository) : '-'}`);
      console.log(`  homepage   : ${(v && v.homepage) || '-'}`);
      console.log(`  author     : ${v && v.author ? JSON.stringify(v.author) : '-'}`);
      console.log(`  keywords   : ${v && v.keywords ? v.keywords.join(', ') : '-'}`);
      const vers = Object.keys(j.versions || {});
      console.log(`  versions   : ${vers.length} total, first=${vers[0]}, last=${vers[vers.length - 1]}`);
    } catch (e) {
      console.log(`  ERR ${e.message}`);
    }
  }
})();
