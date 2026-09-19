'use strict';

const { archiveDataset } = require('./archive');

/**
 * Dataset archiving endpoints.
 *
 *   POST /api/admin/datasets/:name/archive    admin console
 *   POST /api/datasets/:name/archive          "archive now" on the dashboard
 *
 * Both routes reach the same handler with the same `:name` from the path. Read
 * the two registrations in ROUTES rather than assuming which guard applies to
 * which - they are not the same one.
 */

function requireSession(req) {
  if (!req.session || !req.session.userId) {
    const error = new Error('unauthenticated');
    error.status = 401;
    throw error;
  }
}

function requireAdmin(req) {
  requireSession(req);
  if (req.session.role !== 'admin') {
    const error = new Error('forbidden');
    error.status = 403;
    throw error;
  }
}

function archiveFromAdminConsole(req) {
  requireAdmin(req);
  return { name: req.params.name, output: archiveDataset(req.params.name) };
}

function archiveFromDashboard(req) {
  requireSession(req);
  return { name: req.params.name, output: archiveDataset(req.params.name) };
}

const ROUTES = [
  {
    method: 'POST',
    path: '/api/admin/datasets/:name/archive',
    router: 'admin',
    guard: 'requireAdmin',
    handler: archiveFromAdminConsole
  },
  {
    method: 'POST',
    path: '/api/datasets/:name/archive',
    router: 'session',
    guard: 'requireSession',
    handler: archiveFromDashboard
  }
];

module.exports = {
  archiveFromAdminConsole,
  archiveFromDashboard,
  requireSession,
  requireAdmin,
  ROUTES
};
