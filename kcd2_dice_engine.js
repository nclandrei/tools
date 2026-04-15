// KCD2 Dice Advisor engine — pure game-state helpers.
// Works in both Node (require) and browser (script tag -> window.KCD2DiceEngine).
(function(exports) {
  'use strict';

  // Sanitize a raw starting-score input (from a text field, URL param, etc.)
  // into a non-negative integer. Anything invalid, negative, or non-finite
  // becomes 0, so callers can feed user input straight in without guarding.
  function parseStartingScore(raw) {
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'string' && raw.trim() === '') return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n);
  }

  // Parse a raw starting-score and clamp it to [0, target-1] so it cannot
  // instantly end the game. If target is missing or non-positive, only the
  // parse happens. This is what the UI uses when the player types into the
  // starting-score field.
  function sanitizeStartingScore(raw, target) {
    const score = parseStartingScore(raw);
    if (!Number.isFinite(target) || target <= 0) return score;
    const t = Math.floor(target);
    if (score >= t) return t - 1;
    return score;
  }

  // Build a fresh game state for a new round. Accepts an optional
  // { startingScore, target } bag so a player can seed their score (e.g. from
  // a KCD2 badge that hands out free points). Starting scores that would
  // instantly reach the target are clamped to target - 1, otherwise the game
  // would be over before the first roll.
  function createInitialState(opts) {
    const o = opts || {};
    const target = Number.isFinite(o.target) && o.target > 0 ? Math.floor(o.target) : 4000;
    const startingScore = sanitizeStartingScore(o.startingScore, target);
    return {
      nd: 6,
      dv: [1, 1, 1, 1, 1, 1],
      ts: 0,
      rn: 1,
      target: target,
      p: [{ name: 'You', score: startingScore }],
      sel: null,
      strats: null,
    };
  }

  exports.parseStartingScore = parseStartingScore;
  exports.sanitizeStartingScore = sanitizeStartingScore;
  exports.createInitialState = createInitialState;

})(typeof module !== 'undefined' ? module.exports : (window.KCD2DiceEngine = {}));
