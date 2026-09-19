// Probe Greek-root candidate names: DSH catalog + npm availability.
const http = require('http');
const https = require('https');
const d = require(require('path').join(__dirname, '..', 'data', 'dsh-plugins.json'));

const PROXY = { host: '127.0.0.1', port: 7897 };
const NAMES = [
  'themis', 'krites', 'basanos', 'elenchus', 'aletheia',
  'krisis', 'kriterion', 'aeacus', 'elenchos', 'tekmerion',
  'pistis', 'semeion', 'horkos', 'euthyna', 'exetasis',
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
          headers: { host: target, 'user-agent': 'probe', accept: 'application/json' } },
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
  console.log('name         catalog  npm');
  console.log('-----------  -------  ------------------------------------------');
  for (const n of NAMES) {
    const catHit = d.plugins.filter((p) => p.name.toLowerCase().includes(n)).length;
    let npm;
    try {
      const res = await get('registry.npmjs.org', `/${n}`);
      if (res.status === 404) npm = 'FREE';
      else if (res.status === 200) {
        const j = JSON.parse(res.body);
        npm = `TAKEN v${(j['dist-tags'] || {}).latest}  ${(j.description || '').slice(0, 42)}`;
      } else npm = `HTTP ${res.status}`;
    } catch (e) { npm = `ERR ${e.message}`; }
    console.log(`${n.padEnd(12)} ${String(catHit).padStart(4)}     ${npm}`);
  }
})();
