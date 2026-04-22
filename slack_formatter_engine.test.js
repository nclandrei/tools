// Run with: node --test slack_formatter_engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  unwrapHardBreaks,
  stripCommonIndent,
  normalizeWhitespace,
  fenceTables,
  transformInline,
  markdownToSlack,
} = require('./slack_formatter_engine.js');

test('merges hard-wrapped lines in a single paragraph', () => {
  const input = [
    'Hey this is',
    'andrei and I want to',
    'Do this thing',
  ].join('\n');
  assert.equal(
    unwrapHardBreaks(input),
    'Hey this is andrei and I want to Do this thing'
  );
});

test('preserves paragraph breaks', () => {
  const input = [
    'First line of',
    'paragraph one.',
    '',
    'Second',
    'paragraph.',
  ].join('\n');
  assert.equal(
    unwrapHardBreaks(input),
    'First line of paragraph one.\n\nSecond paragraph.'
  );
});

test('merges list item continuations but keeps items separate', () => {
  const input = [
    '- item one',
    '  continues here',
    '- item two',
  ].join('\n');
  assert.equal(
    unwrapHardBreaks(input),
    '- item one continues here\n- item two'
  );
});

test('keeps body text separate from preceding heading', () => {
  const input = [
    '# Heading',
    'Body text',
    'more body',
  ].join('\n');
  assert.equal(
    unwrapHardBreaks(input),
    '# Heading\nBody text more body'
  );
});

test('passes code block contents through untouched', () => {
  const input = [
    '```',
    'line a',
    'line b',
    '```',
    'after text',
    'more',
  ].join('\n');
  assert.equal(
    unwrapHardBreaks(input),
    '```\nline a\nline b\n```\nafter text more'
  );
});

test('merges wrapped lines inside a blockquote', () => {
  const input = [
    '> quote line one',
    'quote continuation',
  ].join('\n');
  assert.equal(
    unwrapHardBreaks(input),
    '> quote line one quote continuation'
  );
});

test('handles ordered lists', () => {
  const input = [
    '1. first',
    '   continued',
    '2. second',
  ].join('\n');
  assert.equal(
    unwrapHardBreaks(input),
    '1. first continued\n2. second'
  );
});

test('does not merge across horizontal rule', () => {
  const input = [
    'before rule',
    '---',
    'after rule',
    'more after',
  ].join('\n');
  assert.equal(
    unwrapHardBreaks(input),
    'before rule\n---\nafter rule more after'
  );
});

test('handles empty input', () => {
  assert.equal(unwrapHardBreaks(''), '');
});

test('does not touch a single line', () => {
  assert.equal(unwrapHardBreaks('just one line'), 'just one line');
});

test('collapses multiple trailing/leading whitespace when merging', () => {
  const input = 'foo   \n   bar';
  assert.equal(unwrapHardBreaks(input), 'foo bar');
});

test('stripCommonIndent removes the Claude Code 2-space terminal pad', () => {
  const input = '  hello\n  world\n\n  again';
  assert.equal(stripCommonIndent(input), 'hello\nworld\n\nagain');
});

test('stripCommonIndent leaves text alone when one line has no indent', () => {
  const input = '  hello\nno indent here';
  assert.equal(stripCommonIndent(input), '  hello\nno indent here');
});

test('normalizeWhitespace trims trailing spaces and surrounding blank lines', () => {
  const input = '\n\n  first   \nsecond\n\n\n';
  assert.equal(normalizeWhitespace(input), '  first\nsecond');
});

test('unwrapHardBreaks treats markdown pipe tables as structural', () => {
  const input = [
    'Intro line',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '| 3 | 4 |',
  ].join('\n');
  assert.equal(
    unwrapHardBreaks(input),
    'Intro line\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |'
  );
});

test('unwrapHardBreaks treats Unicode box-drawing tables as structural', () => {
  const input = [
    'before table',
    '┌───┬───┐',
    '│ a │ b │',
    '├───┼───┤',
    '│ 1 │ 2 │',
    '└───┴───┘',
    'after text',
    'more after',
  ].join('\n');
  assert.equal(
    unwrapHardBreaks(input),
    'before table\n┌───┬───┐\n│ a │ b │\n├───┼───┤\n│ 1 │ 2 │\n└───┴───┘\nafter text more after'
  );
});

test('fenceTables wraps a markdown pipe table in code fences as aligned plain text', () => {
  const input = [
    'text',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 22 |',
  ].join('\n');
  const expected = [
    'text',
    '',
    '```',
    'a  b',
    '1  22',
    '```',
  ].join('\n');
  assert.equal(fenceTables(input), expected);
});

test('fenceTables preserves Unicode box tables inside a code fence', () => {
  const input = [
    '┌───┬───┐',
    '│ a │ b │',
    '└───┴───┘',
  ].join('\n');
  const expected = [
    '```',
    '┌───┬───┐',
    '│ a │ b │',
    '└───┴───┘',
    '```',
  ].join('\n');
  assert.equal(fenceTables(input), expected);
});

test('transformInline emits Slack bold from **bold**', () => {
  assert.equal(transformInline('**hello**'), '*hello*');
});

test('transformInline does NOT demote bold output to italic', () => {
  // Regression: the italic pass used to re-capture the *bold* emitted by
  // the bold pass and rewrite it as _bold_, losing bold entirely.
  assert.equal(transformInline('**bold** and *italic*'), '*bold* and _italic_');
});

test('transformInline leaves inline code untouched', () => {
  assert.equal(
    transformInline('call `foo(**bar**)` please'),
    'call `foo(**bar**)` please'
  );
});

test('transformInline rewrites markdown links to Slack format', () => {
  assert.equal(
    transformInline('see [docs](https://example.com) now'),
    'see <https://example.com|docs> now'
  );
});

test('transformInline rewrites strike-through', () => {
  assert.equal(transformInline('~~nope~~'), '~nope~');
});

test('markdownToSlack end-to-end: Claude Code terminal paste with indent + wrap + box table', () => {
  const input = [
    '  **Auth Refactor is Live**',
    '',
    "  We've shipped a *major* overhaul of our authentication",
    '  system.',
    '',
    '  - Migrated password hashing to **Argon2id**',
    '  - Replaced legacy `jwt.sign()` calls with a centralized token',
    '    service',
    '',
    '  ```js',
    '  const t = await svc.issue();',
    '  ```',
    '',
    '  ┌─────┬────┐',
    '  │ a   │ b  │',
    '  ├─────┼────┤',
    '  │ 1   │ 2  │',
    '  └─────┴────┘',
    '',
  ].join('\n');
  const expected = [
    '*Auth Refactor is Live*',
    '',
    "We've shipped a _major_ overhaul of our authentication system.",
    '',
    '• Migrated password hashing to *Argon2id*',
    '• Replaced legacy `jwt.sign()` calls with a centralized token service',
    '',
    '```',
    'const t = await svc.issue();',
    '```',
    '',
    '```',
    '┌─────┬────┐',
    '│ a   │ b  │',
    '├─────┼────┤',
    '│ 1   │ 2  │',
    '└─────┴────┘',
    '```',
  ].join('\n');
  assert.equal(markdownToSlack(input), expected);
});

test('markdownToSlack renders a markdown pipe table as aligned monospace', () => {
  const input = [
    'Compare:',
    '',
    '| Metric    | bcrypt | argon2id |',
    '|-----------|--------|----------|',
    '| Memory    | No     | Yes      |',
    '| GPU-hard  | Low    | High     |',
  ].join('\n');
  const out = markdownToSlack(input);
  // Separator row is dropped, columns aligned, wrapped in code fence.
  assert.ok(out.includes('```\nMetric    bcrypt  argon2id'));
  assert.ok(out.includes('Memory    No      Yes'));
  assert.ok(out.includes('GPU-hard  Low     High\n```'));
  assert.ok(!out.includes('---'));
});
