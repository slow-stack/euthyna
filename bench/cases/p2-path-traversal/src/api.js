'use strict';

const { readReport, listReports } = require('./reports');

/**
 * Dashboard report endpoints.
 *
 *   GET /api/reports/:name
 *   GET /api/reports
 *
 * `:name` is taken from the path and passed to the report reader unchanged.
 *
 * Authorization: see MOUNT_ORDER below. It is the wiring, not a description of
 * it - the session middleware is applied to the routes listed under `session`,
 * and the report routes are not among them. They were added before reports were
 * considered sensitive and were never moved.
 */

const MOUNT_ORDER = [
  {
    router: 'public',
    middleware: [],
    routes: ['GET /api/reports/:name', 'GET /api/reports']
  },
  {
    router: 'session',
    middleware: ['requireSession'],
    routes: ['GET /api/me', 'POST /api/settings']
  }
];

function requireSession(req) {
  if (!req.session || !req.session.userId) {
    const error = new Error('unauthenticated');
    error.status = 401;
    throw error;
  }
}

function readReportRoute(req) {
  return { name: req.params.name, contents: readReport(req.params.name) };
}

function listReportsRoute() {
  return { names: listReports() };
}

module.exports = { readReportRoute, listReportsRoute, requireSession, MOUNT_ORDER };
