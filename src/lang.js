/**
 * Language selection for the CLI (i18n).
 *
 * Zero-dependency on purpose, like everything else in this project: no i18n
 * framework is pulled in. The CLI currently ships two languages, chosen by an
 * explicit switch rather than by locale sniffing, because a locale-derived
 * answer can surprise ("I asked for English and got Chinese") and is hard to
 * reproduce in CI.
 *
 * Precedence: an explicit `--lang` flag beats the EUTHYNA_LANG environment
 * variable, which beats the default (Chinese). The default stays Chinese so a
 * user who never asks for English sees exactly the output they saw before.
 */

export const LANGS = Object.freeze(['zh', 'en']);
export const DEFAULT_LANG = 'zh';

/** True for a value the CLI accepts as a language. */
export function isLang(value) {
  return value === 'zh' || value === 'en';
}

/**
 * Resolve the effective language.
 *
 * Precedence: an explicit flag wins, then the environment variable, then the
 * default. cli.js validates the flag value before calling this, so a non-zh/en
 * flag never reaches here.
 *
 * @param {object} [options]
 * @param {string|boolean} [options.flag]  the value of --lang (true when the
 *                                         flag was passed without a value)
 * @param {object} [options.env]  defaults to process.env
 * @returns {'zh'|'en'}
 */
export function resolveLang({ flag, env = process.env } = {}) {
  if (flag === 'en' || flag === 'zh') return flag;
  if (env.EUTHYNA_LANG === 'en') return 'en';
  return DEFAULT_LANG;
}

/**
 * The translation helper. Call it once per scope with the active language:
 *
 *   const t = T(lang);
 *   write(t('已确证', 'Established'));
 *
 * The Chinese text is always the first argument and stays the canonical form;
 * the English is the second. Each call site keeps both strings next to the
 * interpolation that builds them, so a translation cannot drift from the
 * message it translates.
 */
export function T(lang) {
  return (zh, en) => (lang === 'en' ? en : zh);
}
