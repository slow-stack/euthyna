'use strict';

const { fetchUrl } = require('./fetcher');

/**
 * Dataset import endpoints.
 *
 *   POST /api/import    the dashboard's "import from URL" form
 *
 * Reachable by any logged-in user; the URL is taken from the request body.
 * Read the route registration rather than assuming the guard.
 */

function requireSession(req) {
  if (!req.session || !req.session.userId) {
    const error = new Error('unauthenticated');
    error.status = 401;
    throw error;
  }
}

function importFromUrl(req) {
  requireSession(req);
  return fetchUrl(req.body.url).then(result => ({ ok: true, ...result }));
}

const ROUTES = [
  {
    method: 'POST',
    path: '/api/import',
    router: 'session',
    guard: 'requireSession',
    handler: importFromUrl
  }
];

module.exports = { importFromUrl, requireSession, ROUTES };
