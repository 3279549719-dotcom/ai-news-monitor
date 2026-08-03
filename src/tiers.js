'use strict';

const { URL } = require('url');
const tiers = require('./source-tiers.json');

/**
 * Returns the source tier (0–3) for a given URL, or null if not found.
 * Never throws — returns null for empty, null, or undefined input.
 *
 * @param {string|null|undefined} urlString
 * @returns {number|null}
 */
function getTier(urlString) {
  if (!urlString) return null;

  let hostname;
  try {
    hostname = new URL(urlString).hostname;
  } catch {
    return null;
  }

  // Strip leading www.
  const bare = hostname.replace(/^www\./, '');

  const tier = tiers[bare];
  return tier !== undefined ? tier : null;
}

module.exports = { getTier };
