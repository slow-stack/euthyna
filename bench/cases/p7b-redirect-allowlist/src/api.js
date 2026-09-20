'use strict';

const { buildRedirect } = require('./redirect');

/**
 * "Continue to ..." endpoints.
 *
 *   GET /api/goto/:target    post-action bounce shown in the dashboard UI
 *
 * Reachable by any logged-in user; the target is taken from the request path.
 * Read the route registration rather than assuming the guard.
 */

function requireSession(req) {
  if (!req.session || !req.session.userId) {
    const error = new Error('unauthenticated');
    error.status = 401;
    throw error;
  }
}

function goto(req) {
  requireSession(req);
  return buildRedirect(req.params.target);
}

const ROUTES = [
  {
    method: 'GET',
    path: '/api/goto/:target',
    router: 'session',
    guard: 'requireSession',
    handler: goto
  }
];

module.exports = { goto, requireSession, ROUTES };
