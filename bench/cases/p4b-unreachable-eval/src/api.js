'use strict';

const { ruleMatches } = require('./rules');

/**
 * Alert rule evaluation endpoint.
 *
 *   POST /api/workspaces/:workspaceId/rules/evaluate
 *   { "rule": "<expression>", "alert": { "severity": "high", "count": 12 } }
 *
 * The `rule` string is taken straight from the request body. Any member of the
 * workspace can reach this route; it sits behind the normal session login and
 * applies no further role or permission check.
 */
function evaluateRule(req) {
  const { rule, alert } = req.body;
  const matches = ruleMatches(rule, alert);
  return { workspaceId: req.params.workspaceId, matches };
}

module.exports = { evaluateRule };
