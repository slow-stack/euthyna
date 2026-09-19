'use strict';

/*
 * Language tag table.
 *
 * This file is generated. The raw registry is a large plain-text document, and
 * storing every tag as a literal string costs far more gzipped bytes than
 * storing the same data as a nested integer array, so the table below is the
 * encoded form and is not meant to be read by hand.
 *
 * To regenerate after the registry updates, open
 * https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry
 * in a browser and run the following in the console, then paste the printed
 * array over ENCODED_TAGS:
 *
 *   const str = document.querySelector('pre').innerHTML;
 *   const langs = new Set();
 *   str.split('%%').forEach(entry => {
 *     const type = /Type: (\w+)/.exec(entry);
 *     if (type && type[1] === 'language') langs.add(/Subtag: (\w+)/.exec(entry)[1]);
 *   });
 *   console.log(JSON.stringify([...langs]));
 *
 * The runtime never performs this step; it only reads ENCODED_TAGS.
 */

const ENCODED_TAGS = [
  [, [, [, 1]]],
  [, , [1]],
  [, [, 1], [, 2]],
  [, , , [, [, 1]]]
];

function decode(node, prefix = '') {
  const out = [];
  if (node[0] === 1) out.push(prefix);
  for (let i = 1; i < node.length; i++) {
    if (node[i] === undefined) continue;
    out.push(...decode(node[i], prefix + String.fromCharCode(96 + i)));
  }
  return out;
}

const VALID_TAGS = new Set(decode(ENCODED_TAGS));

function isValidLangTag(tag) {
  return VALID_TAGS.has(String(tag).toLowerCase());
}

module.exports = { isValidLangTag, VALID_TAGS, ENCODED_TAGS };
