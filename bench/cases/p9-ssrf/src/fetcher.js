'use strict';

const http = require('node:http');
const https = require('node:https');

/**
 * Import helper: the dashboard can import datasets from a URL. The URL comes
 * from a form field on the import page, which any logged-in user can submit.
 * The process's network position (internal admin services, cloud metadata
 * endpoints) is whatever the deployment gives it.
 */

function fetchUrl(rawUrl) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = rawUrl.startsWith('https:') ? https.get(rawUrl) : http.get(rawUrl);
    } catch (error) {
      reject(error);
      return;
    }
    request.setTimeout(5000, () => request.destroy(new Error('import request timed out')));
    request.once('response', response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    request.once('error', reject);
  });
}

module.exports = { fetchUrl };
