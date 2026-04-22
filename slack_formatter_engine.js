// Paste Formatter engine — pure text-shaping helpers.
// Works in both Node (require) and browser (script tag -> window.SlackFormatter)
(function(exports) {
  'use strict';

  // Unicode box-drawing block (U+2500..U+257F) covers every character Claude
  // Code's TUI uses for rendered table borders: - | + etc.
  const BOX_DRAWING_RE = /[─-╿]/;

  function isPipeTableRow(line) {
    const t = line.replace(/^\s+/, '');
    if (t[0] !== '|') return false;
    return t.indexOf('|', 1) !== -1;
  }

  function isPipeTableSeparator(line) {
    const t = line.replace(/^\s+/, '').replace(/\s+$/, '');
    return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(t);
  }

  function isBoxTableLine(line) {
    return BOX_DRAWING_RE.test(line);
  }

  function isTableLine(line) {
    return isPipeTableRow(line) || isBoxTableLine(line);
  }

  // A "structural" line introduces a new logical block (heading, list item,
  // blockquote, horizontal rule, code fence, or table row). Structural lines
  // never merge into the previous line, and plain continuation text that
  // follows them gets merged in.
  function isStructural(line) {
    if (isTableLine(line)) return true;
    return /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|(-{3,}|_{3,}|\*{3,})\s*$|```)/.test(line);
  }

  // Headings, horizontal rules, code fences and tables are "terminal" —
  // continuation text after one of these starts a fresh chunk.
  function isHeadingOrHr(line) {
    if (isTableLine(line)) return true;
    return /^\s*(#{1,6}\s|(-{3,}|_{3,}|\*{3,})\s*$|```)/.test(line);
  }

  // Strip the common leading-whitespace prefix — Claude Code's TUI indents
  // rendered assistant output by a constant amount (typically 2 spaces),
  // and pasted text carries that through. Empty lines are ignored when
  // measuring the indent.
  exports.stripCommonIndent = function(text) {
    if (typeof text !== 'string' || text.length === 0) return text || '';
    const lines = text.split('\n');
    let minIndent = Infinity;
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const match = line.match(/^([ \t]*)/);
      const len = match ? match[1].length : 0;
      if (len < minIndent) minIndent = len;
      if (minIndent === 0) break;
    }
    if (minIndent === 0 || minIndent === Infinity) return text;
    return lines.map(l => l.length >= minIndent ? l.slice(minIndent) : l).join('\n');
  };

  // Normalize newlines, drop trailing whitespace per line, and trim leading
  // and trailing blank lines.
  exports.normalizeWhitespace = function(text) {
    if (typeof text !== 'string' || text.length === 0) return text || '';
    const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+$/, ''));
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim() === '') start++;
    while (end > start && lines[end - 1].trim() === '') end--;
    return lines.slice(start, end).join('\n');
  };

  // Join hard-wrapped lines inside a paragraph back into a single line, while
  // preserving blank-line paragraph breaks, code blocks, lists, blockquotes,
  // headings, and tables.
  exports.unwrapHardBreaks = function(text) {
    if (typeof text !== 'string' || text.length === 0) return text || '';

    const lines = text.split('\n');
    const out = [];
    let inCode = false;
    let lastWasBlank = true;

    for (const line of lines) {
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

      if (line.trim() === '') {
        out.push('');
        lastWasBlank = true;
        continue;
      }

      if (lastWasBlank) {
        out.push(line);
        lastWasBlank = false;
        continue;
      }

      const prev = out[out.length - 1];
      if (isStructural(line) || isHeadingOrHr(prev)) {
        out.push(line);
      } else {
        out[out.length - 1] = prev.replace(/\s+$/, '') + ' ' + line.replace(/^\s+/, '');
      }
    }

    return out.join('\n');
  };

  // Wrap contiguous table blocks (markdown pipe and Unicode box-drawing) in
  // Slack ``` fences so alignment survives pasting into Slack's proportional
  // font. Pipe tables are rewritten as column-aligned plain text (separator
  // row dropped). Box-drawing tables are preserved as-is.
  // Expects input to already be dedented and unwrapped.
  exports.fenceTables = function(text) {
    if (typeof text !== 'string' || text.length === 0) return text || '';
    const lines = text.split('\n');
    const out = [];
    let inCode = false;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (/^\s*```/.test(line)) {
        out.push(line);
        inCode = !inCode;
        i++;
        continue;
      }
      if (inCode) {
        out.push(line);
        i++;
        continue;
      }

      if (isTableLine(line)) {
        const block = [];
        while (i < lines.length && isTableLine(lines[i])) {
          block.push(lines[i]);
          i++;
        }
        const cleaned = block.filter(l => !isPipeTableSeparator(l));
        const formatted = formatTableBlock(cleaned);
        out.push('```');
        for (const row of formatted) out.push(row);
        out.push('```');
        continue;
      }

      out.push(line);
      i++;
    }

    return out.join('\n');
  };

  function formatTableBlock(block) {
    const allPipe = block.length > 0 && block.every(isPipeTableRow);
    if (!allPipe) return block;

    const rows = block.map(line => {
      let t = line.replace(/^\s+/, '').replace(/\s+$/, '');
      if (t.startsWith('|')) t = t.slice(1);
      if (t.endsWith('|')) t = t.slice(0, -1);
      return t.split('|').map(c => c.trim());
    });

    const cols = Math.max(...rows.map(r => r.length));
    const widths = new Array(cols).fill(0);
    for (const r of rows) {
      for (let c = 0; c < r.length; c++) {
        const w = [...r[c]].length;
        if (w > widths[c]) widths[c] = w;
      }
    }
    return rows.map(r => {
      const cells = [];
      for (let c = 0; c < cols; c++) {
        const cell = r[c] || '';
        const pad = widths[c] - [...cell].length;
        cells.push(cell + ' '.repeat(Math.max(0, pad)));
      }
      return cells.join('  ').replace(/\s+$/, '');
    });
  }

  // Convert inline markdown to Slack mrkdwn. Bold/italic/strike/code are
  // swapped out for U+E000-delimited placeholders before the italic pass so
  // the single asterisks emitted by the bold pass cannot be re-captured as
  // italic — the canonical **bold** -> *bold* -> _bold_ regression.
  exports.transformInline = function(line) {
    const codeSpans = [];
    const bolds = [];
    const strikes = [];

    line = line.replace(/`[^`\n]+`/g, (m) => {
      codeSpans.push(m);
      return 'C' + (codeSpans.length - 1) + '';
    });

    line = line.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<$2|$1>');
    line = line.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<$2|$1>');

    line = line.replace(/~~([^~\n]+)~~/g, (_m, t) => {
      strikes.push(t);
      return 'S' + (strikes.length - 1) + '';
    });

    line = line.replace(/\*\*([^*\n]+)\*\*/g, (_m, t) => {
      bolds.push(t);
      return 'B' + (bolds.length - 1) + '';
    });
    line = line.replace(/__([^_\n]+)__/g, (_m, t) => {
      bolds.push(t);
      return 'B' + (bolds.length - 1) + '';
    });

    line = line.replace(/(?<![*\w])\*([^*\n]+?)\*(?![*\w])/g, '_$1_');
    line = line.replace(/(?<![_\w])_([^_\n]+?)_(?![_\w])/g, '_$1_');

    line = line.replace(/B(\d+)/g, (_m, i) => '*' + bolds[+i] + '*');
    line = line.replace(/S(\d+)/g, (_m, i) => '~' + strikes[+i] + '~');
    line = line.replace(/C(\d+)/g, (_m, i) => codeSpans[+i]);

    return line;
  };

  // Full pipeline: raw paste -> Slack-ready text.
  exports.markdownToSlack = function(md) {
    md = exports.normalizeWhitespace(md);
    md = exports.stripCommonIndent(md);
    md = exports.unwrapHardBreaks(md);
    md = exports.fenceTables(md);

    const lines = md.split('\n');
    const out = [];
    let inCodeBlock = false;
    let codeLines = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      if (/^\s*```/.test(line)) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLines = [];
          continue;
        }
        inCodeBlock = false;
        out.push('```');
        out.push(...codeLines);
        out.push('```');
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      line = line.replace(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/, '*$1*');

      if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
        out.push('---');
        continue;
      }

      line = line.replace(/^(\s*)[-*+]\s+/, (_m, indent) => {
        const depth = Math.floor(indent.length / 2);
        return '  '.repeat(depth) + '• ';
      });

      line = exports.transformInline(line);
      out.push(line);
    }

    if (inCodeBlock) {
      out.push('```');
      out.push(...codeLines);
      out.push('```');
    }

    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  exports._isStructural = isStructural;
  exports._isHeadingOrHr = isHeadingOrHr;
  exports._isPipeTableRow = isPipeTableRow;
  exports._isPipeTableSeparator = isPipeTableSeparator;
  exports._isBoxTableLine = isBoxTableLine;
  exports._formatTableBlock = formatTableBlock;

})(typeof module !== 'undefined' ? module.exports : (window.SlackFormatter = {}));
