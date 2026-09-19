'use strict';

/**
 * Alert rules.
 *
 * Operators write rules as small expressions over an alert row, for example
 * "row.severity === 'high' && row.count > 10". Rules are stored per workspace
 * and evaluated on every incoming alert.
 */

const compiled = new Map();

function compileRule(expression) {
  if (compiled.has(expression)) return compiled.get(expression);

  // eslint-disable-next-line no-new-func
  const predicate = new Function('row', `return (${expression});`);
  compiled.set(expression, predicate);
  return predicate;
}

function ruleMatches(expression, row) {
  return Boolean(compileRule(expression)(row));
}

module.exports = { compileRule, ruleMatches };
