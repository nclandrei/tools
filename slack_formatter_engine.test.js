// Run with: node --test slack_formatter_engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { unwrapHardBreaks } = require('./slack_formatter_engine.js');

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
