'use strict';

/**
 * URL -> source-tier resolution.
 *
 * Maps a URL's hostname to its reliability tier (0 = most trusted) using the
 * external source-tiers.json table. Used to give the AI a credibility hint and
 * to compute corroboration in crosscheck.
 */

const { URL } = require('url');
const tiers = require('./source-tiers.json');
const { T0_FLOOR, T1_FLOOR } = require('./config');

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

/**
 * Apply tier-based score floor.
 * T0 → T0_FLOOR, T1 → T1_FLOOR. Other tiers return the original score.
 * @param {number} score - AI raw score.
 * @param {number|null} tier - Source credibility tier.
 * @returns {number} Adjusted score.
 */
function applyTierFloor(score, tier) {
  if (tier === 0) return Math.max(score, T0_FLOOR);
  if (tier === 1) return Math.max(score, T1_FLOOR);
  return score;
}

module.exports = { getTier, applyTierFloor };
