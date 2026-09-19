// Check npm name availability through the local proxy CONNECT tunnel.
const http = require('http');
const https = require('https');

const PROXY = { host: '127.0.0.1', port: 7897 };
// Names come from the command line; the original hardcoded list is the default.
const NAMES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'dsh-finding-verdict',
      'dsh-verdict',
      'dsh-audit-verdict',
      'dsh-adjudicator',
      'dsh-corroborator',
      'dsh-witness',
      'dsh-finding',
      'dsh-evidence-gate',
      'dsh-proof',
      'dsh-audit-engine',
    ];

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
    try {
      const res = await get('registry.npmjs.org', `/${encodeURIComponent(n)}`);
      if (res.status === 404) {
        console.log(`FREE   ${n}`);
      } else if (res.status === 200) {
        const j = JSON.parse(res.body);
        const latest = j['dist-tags'] && j['dist-tags'].latest;
        const created = j.time && j.time.created ? j.time.created.slice(0, 10) : '?';
        console.log(`TAKEN  ${n}  (v${latest}, created ${created})`);
      } else {
        console.log(`?${res.status}  ${n}`);
      }
    } catch (e) {
      console.log(`ERR    ${n}: ${e.message}`);
    }
  }
})();
