'use strict';

/**
 * Application configuration loader.
 *
 * Defaults are merged with whatever the caller passes in. In the API layer the
 * overrides object is the parsed request body, so its shape is caller-controlled.
 */

const DEFAULTS = Object.freeze({
  theme: 'light',
  locale: 'en',
  features: { export: true, beta: false }
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (isPlainObject(value) && isPlainObject(target[key])) {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function loadConfig(overrides) {
  const base = { ...DEFAULTS, features: { ...DEFAULTS.features } };
  if (!isPlainObject(overrides)) return base;
  return deepMerge(base, overrides);
}

module.exports = { loadConfig, deepMerge, DEFAULTS };
