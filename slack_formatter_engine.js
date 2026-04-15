// Paste Formatter engine — pure text-shaping helpers
// Works in both Node (require) and browser (script tag -> window.SlackFormatter)
(function(exports) {
  'use strict';

  // A "structural" line introduces a new logical block (heading, list item,
  // blockquote, horizontal rule, code fence). Such lines never merge into
  // the previous line, and plain continuation lines that follow them get
  // merged into them.
  function isStructural(line) {
    return /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|(-{3,}|_{3,}|\*{3,})\s*$|```)/.test(line);
  }

  // Headings, horizontal rules and code fences are "terminal" — continuation
  // text after one of these starts a fresh chunk instead of merging into it.
  function isHeadingOrHr(line) {
    return /^\s*(#{1,6}\s|(-{3,}|_{3,}|\*{3,})\s*$|```)/.test(line);
  }

  // Join hard-wrapped lines inside a paragraph back into a single line,
  // while preserving blank-line paragraph breaks, code blocks, lists,
  // blockquotes, and headings.
  exports.unwrapHardBreaks = function(text) {
    if (typeof text !== 'string' || text.length === 0) return text || '';

    const lines = text.split('\n');
    const out = [];
    let inCode = false;
    let lastWasBlank = true;

    for (const line of lines) {
      // Code fence toggle — fences and their contents pass through verbatim.
      if (/^\s*```/.test(line)) {
        out.push(line);
        inCode = !inCode;
        lastWasBlank = false;
        continue;
      }
      if (inCode) {
        out.push(line);
        lastWasBlank = false;
        continue;
      }

      // Blank line → paragraph break.
      if (line.trim() === '') {
        out.push('');
        lastWasBlank = true;
        continue;
      }

      // First non-blank line of a block always starts a new chunk.
      if (lastWasBlank) {
        out.push(line);
        lastWasBlank = false;
        continue;
      }

      const prev = out[out.length - 1];
      if (isStructural(line) || isHeadingOrHr(prev)) {
        // Structural lines start a new chunk; nothing merges into a heading/HR.
        out.push(line);
      } else {
        // Merge continuation into previous chunk, collapsing any wrap whitespace.
        out[out.length - 1] = prev.replace(/\s+$/, '') + ' ' + line.replace(/^\s+/, '');
      }
    }

    return out.join('\n');
  };

  // Exposed for tests.
  exports._isStructural = isStructural;
  exports._isHeadingOrHr = isHeadingOrHr;

})(typeof module !== 'undefined' ? module.exports : (window.SlackFormatter = {}));
