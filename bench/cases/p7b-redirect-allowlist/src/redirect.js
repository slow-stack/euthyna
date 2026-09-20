'use strict';

/**
 * Login-flow redirect builder.
 *
 * After certain actions the dashboard bounces the user to a "continue to"
 * target chosen by the caller of the route. The target arrives as a path
 * parameter on a route any logged-in user can reach.
 */

const ALLOWED_TARGET_HOSTS = new Set(['portal.internal.example', 'files.internal.example']);

function buildRedirect(target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    const error = new Error('redirect target must be an absolute URL');
    error.status = 400;
    throw error;
  }
  if (!ALLOWED_TARGET_HOSTS.has(parsed.host)) {
    const error = new Error('redirect target host is not allowed');
    error.status = 400;
    throw error;
  }
  return { status: 302, headers: { Location: target } };
}

module.exports = { buildRedirect };
