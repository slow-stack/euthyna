// Fetch the DSH plugin catalog through the local HTTP proxy using a CONNECT tunnel.
// Node's own TLS stack is used because curl/schannel cannot acquire credentials under the sandbox.
const http = require('http');
const https = require('https');
const fs = require('fs');

const PROXY = { host: '127.0.0.1', port: 7897 };
const TARGET = process.argv[2] || 'awesome-dsh-plugin.com';
const PATH = process.argv[3] || '/plugins.json';
const OUT = process.argv[4] || 'dsh-plugins.json';

const connectReq = http.request({
  host: PROXY.host,
  port: PROXY.port,
  method: 'CONNECT',
  path: `${TARGET}:443`,
  headers: { host: `${TARGET}:443` },
});

connectReq.on('connect', (res, socket) => {
  if (res.statusCode !== 200) {
    console.error(`proxy CONNECT failed: ${res.statusCode}`);
    process.exit(2);
  }
  const req = https.request(
    {
      socket,
      agent: false,
      servername: TARGET,
      path: PATH,
      method: 'GET',
      headers: {
        host: TARGET,
        accept: 'application/json',
        'user-agent': 'dsh-catalog-fetch',
      },
    },
    (r) => {
      console.error(`status=${r.statusCode}`);
      if (r.statusCode !== 200) {
        process.exit(3);
      }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const buf = Buffer.concat(chunks);
        fs.writeFileSync(OUT, buf);
        console.log(`OK bytes=${buf.length} -> ${OUT}`);
      });
    }
  );
  req.on('error', (e) => {
    console.error(`request error: ${e.message}`);
    process.exit(4);
  });
  req.end();
});

connectReq.on('error', (e) => {
  console.error(`connect error: ${e.message}`);
  process.exit(1);
});

connectReq.setTimeout(30000, () => {
  console.error('connect timeout');
  process.exit(5);
});
connectReq.end();
