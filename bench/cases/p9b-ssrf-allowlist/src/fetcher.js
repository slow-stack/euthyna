'use strict';

const http = require('node:http');
const https = require('node:https');

/**
 * Import helper: the dashboard can import datasets from a URL. The URL comes
 * from a form field on the import page, which any logged-in user can submit.
 * Imports are pinned to an allow-list of dataset hosts; anything else is
 * rejected before a request is made.
 */

const ALLOWED_IMPORT_HOSTS = new Set(['data.internal.example']);

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function fetchUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return Promise.reject(badRequest('import URL must be an absolute URL'));
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Promise.reject(badRequest('import URL protocol not allowed'));
  }
  if (!ALLOWED_IMPORT_HOSTS.has(parsed.host)) {
    return Promise.reject(badRequest('import URL host is not allowed'));
  }
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
