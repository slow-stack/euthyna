'use strict';

const { loadConfig } = require('./config');

/**
 * Workspace settings endpoint.
 *
 *   POST /api/workspaces/:workspaceId/settings
 *   { "theme": "dark", "features": { "beta": true } }
 *
 * The parsed request body is handed to the config loader as the overrides
 * object; this layer applies no allow-list of its own.
 *
 * Authorization: `requireSession` is the only guard on this route. It proves
 * there is a logged-in user and nothing else - it does not compare the
 * `:workspaceId` in the path against the caller's own workspaces, and it does
 * not check any role.
 */

function requireSession(req) {
  if (!req.session || !req.session.userId) {
    const error = new Error('unauthenticated');
    error.status = 401;
    throw error;
  }
}

function updateSettings(req) {
  requireSession(req);
  const config = loadConfig(req.body);
  return { workspaceId: req.params.workspaceId, config };
}

module.exports = { updateSettings, requireSession };
