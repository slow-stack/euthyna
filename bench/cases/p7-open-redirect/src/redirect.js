'use strict';

/**
 * Login-flow redirect builder.
 *
 * After certain actions the dashboard bounces the user to a "continue to"
 * target chosen by the caller of the route. The target arrives as a path
 * parameter on a route any logged-in user can reach.
 */

function buildRedirect(target) {
  return { status: 302, headers: { Location: target } };
}

module.exports = { buildRedirect };
