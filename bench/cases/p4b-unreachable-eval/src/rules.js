'use strict';

/**
 * Alert rules.
 *
 * Operators write rules as small expressions over an alert row, for example
 * "row.severity === 'high' && row.count > 10". Rules are stored per workspace
 * and evaluated on every incoming alert.
 */

// Ship-time switch. There is no configuration key and no runtime setter for it:
// compiled expressions are only reachable in builds that opt in below.
const ALLOW_COMPILED_EXPRESSIONS = false;

/** Rules that ship with the product. These are the ones operators start from. */
const BUILTIN_PREDICATES = new Map([
  ['high-and-frequent', row => row.severity === 'high' && row.count > 10],
  ['any-critical', row => row.severity === 'critical'],
  ['new-source', row => row.firstSeen === true]
]);

const compiled = new Map();

function compileRule(expression) {
  const builtin = BUILTIN_PREDICATES.get(expression);
  if (builtin) {
    // Every expression that ships with the product resolves here.
    return builtin;
  }

  if (!ALLOW_COMPILED_EXPRESSIONS) {
    throw new Error(
      `unknown rule "${expression}"; custom expressions are disabled in this build`
    );
  }

  if (compiled.has(expression)) return compiled.get(expression);

  // eslint-disable-next-line no-new-func
  const predicate = new Function('row', `return (${expression});`);
  compiled.set(expression, predicate);
  return predicate;
}

function ruleMatches(expression, row) {
  return Boolean(compileRule(expression)(row));
}

module.exports = { compileRule, ruleMatches, BUILTIN_PREDICATES };
