const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./prompt_inspector_engine');

// ============================================================
// 1. SIZE METRICS
// ============================================================
describe('Size Metrics', () => {
  describe('countChars', () => {
    it('counts characters in a string', () => {
      assert.equal(engine.countChars('hello'), 5);
    });
    it('returns 0 for empty string', () => {
      assert.equal(engine.countChars(''), 0);
    });
    it('counts unicode correctly', () => {
      assert.equal(engine.countChars('café'), 4);
    });
  });

  describe('countWords', () => {
    it('counts words split by whitespace', () => {
      assert.equal(engine.countWords('hello world foo'), 3);
    });
    it('returns 0 for empty string', () => {
      assert.equal(engine.countWords(''), 0);
    });
    it('handles multiple spaces and newlines', () => {
      assert.equal(engine.countWords('hello   world\n\nfoo'), 3);
    });
  });

  describe('countSentences', () => {
    it('counts sentences ending with . ! ?', () => {
      assert.equal(engine.countSentences('Hello. World! How?'), 3);
    });
    it('returns 1 for text without punctuation', () => {
      assert.equal(engine.countSentences('hello world'), 1);
    });
    it('handles abbreviations like e.g. and i.e.', () => {
      // "Use e.g. this approach. Then do that." = 2 sentences
      assert.equal(engine.countSentences('Use e.g. this approach. Then do that.'), 2);
    });
  });

  describe('countLines', () => {
    it('counts total lines', () => {
      assert.equal(engine.countLines('a\nb\nc'), 3);
    });
    it('returns 1 for single line', () => {
      assert.equal(engine.countLines('hello'), 1);
    });
    it('returns 0 for empty string', () => {
      assert.equal(engine.countLines(''), 0);
    });
  });

  describe('countBlankLines', () => {
    it('counts blank lines', () => {
      assert.equal(engine.countBlankLines('a\n\nb\n\n\nc'), 3);
    });
    it('returns 0 when no blank lines', () => {
      assert.equal(engine.countBlankLines('a\nb\nc'), 0);
    });
  });

  describe('estimateTokens', () => {
    it('estimates tokens using word-based heuristic', () => {
      // ~1.33 tokens per word, roughly chars/4
      const text = 'The quick brown fox jumps over the lazy dog';
      const tokens = engine.estimateTokens(text);
      assert.ok(tokens > 8 && tokens < 16, `expected 8-16, got ${tokens}`);
    });
    it('returns 0 for empty string', () => {
      assert.equal(engine.estimateTokens(''), 0);
    });
    it('handles code with special tokens', () => {
      const code = 'function foo() { return bar.baz(); }';
      const tokens = engine.estimateTokens(code);
      assert.ok(tokens > 5, `expected >5 tokens for code, got ${tokens}`);
    });
  });

  describe('estimateCost', () => {
    it('returns cost in dollars for claude-sonnet input tokens', () => {
      const cost = engine.estimateCost(1000, 'claude-sonnet');
      assert.ok(cost > 0, 'cost should be positive');
      assert.equal(typeof cost, 'number');
    });
    it('returns cost for gpt-4o', () => {
      const cost = engine.estimateCost(1000, 'gpt-4o');
      assert.ok(cost > 0);
    });
    it('returns 0 for 0 tokens', () => {
      assert.equal(engine.estimateCost(0, 'claude-sonnet'), 0);
    });
  });

  describe('contextWindowPercent', () => {
    it('returns percentage of context window used', () => {
      const pct = engine.contextWindowPercent(100000, 'claude-sonnet');
      assert.ok(pct > 0 && pct <= 100);
    });
    it('returns 0 for 0 tokens', () => {
      assert.equal(engine.contextWindowPercent(0, 'claude-sonnet'), 0);
    });
  });
});

// ============================================================
// 2. STRUCTURAL ANALYSIS
// ============================================================
describe('Structural Analysis', () => {
  describe('extractHeadings', () => {
    it('extracts markdown headings with levels', () => {
      const text = '# Title\n\nSome text\n\n## Section\n\n### Subsection';
      const headings = engine.extractHeadings(text);
      assert.equal(headings.length, 3);
      assert.deepEqual(headings[0], { level: 1, text: 'Title', line: 1 });
      assert.deepEqual(headings[1], { level: 2, text: 'Section', line: 5 });
      assert.deepEqual(headings[2], { level: 3, text: 'Subsection', line: 7 });
    });
    it('returns empty array for no headings', () => {
      assert.deepEqual(engine.extractHeadings('just text'), []);
    });
    it('ignores # inside code blocks', () => {
      const text = '# Real heading\n\n```\n# Not a heading\n```';
      const headings = engine.extractHeadings(text);
      assert.equal(headings.length, 1);
      assert.equal(headings[0].text, 'Real heading');
    });
  });

  describe('detectXmlTags', () => {
    it('finds XML tags in prompt text', () => {
      const text = '<system>You are helpful</system>\n<context>Some context</context>';
      const tags = engine.detectXmlTags(text);
      assert.ok(tags.includes('system'));
      assert.ok(tags.includes('context'));
    });
    it('returns empty array for no tags', () => {
      assert.deepEqual(engine.detectXmlTags('no tags here'), []);
    });
    it('deduplicates tags', () => {
      const text = '<role>A</role> <role>B</role>';
      const tags = engine.detectXmlTags(text);
      assert.equal(tags.filter(t => t === 'role').length, 1);
    });
    it('ignores common HTML tags', () => {
      const text = '<div>hello</div><instructions>do stuff</instructions>';
      const tags = engine.detectXmlTags(text);
      assert.ok(!tags.includes('div'));
      assert.ok(tags.includes('instructions'));
    });
  });

  describe('countMarkdownElements', () => {
    it('counts code blocks, lists, links, bold, italic', () => {
      const text = '**bold** and *italic*\n\n- item1\n- item2\n\n```js\ncode\n```\n\n[link](url)';
      const counts = engine.countMarkdownElements(text);
      assert.equal(counts.codeBlocks, 1);
      assert.equal(counts.listItems, 2);
      assert.equal(counts.links, 1);
      assert.equal(counts.bold, 1);
      assert.equal(counts.italic, 1);
    });
    it('returns all zeros for plain text', () => {
      const counts = engine.countMarkdownElements('just plain text');
      assert.equal(counts.codeBlocks, 0);
      assert.equal(counts.listItems, 0);
      assert.equal(counts.links, 0);
    });
  });
});

// ============================================================
// 3. VARIABLE/PLACEHOLDER DETECTION
// ============================================================
describe('Variable/Placeholder Detection', () => {
  describe('detectVariables', () => {
    it('finds {{variable}} placeholders', () => {
      const vars = engine.detectVariables('Hello {{name}}, your id is {{user_id}}');
      assert.ok(vars.includes('{{name}}'));
      assert.ok(vars.includes('{{user_id}}'));
    });
    it('finds {variable} placeholders', () => {
      const vars = engine.detectVariables('Hello {name}');
      assert.ok(vars.includes('{name}'));
    });
    it('finds ${variable} placeholders', () => {
      const vars = engine.detectVariables('Path is ${HOME}/dir');
      assert.ok(vars.includes('${HOME}'));
    });
    it('finds __VARIABLE__ placeholders', () => {
      const vars = engine.detectVariables('Replace __API_KEY__ here');
      assert.ok(vars.includes('__API_KEY__'));
    });
    it('deduplicates variables', () => {
      const vars = engine.detectVariables('{{name}} and {{name}} again');
      assert.equal(vars.filter(v => v === '{{name}}').length, 1);
    });
    it('returns empty array for no variables', () => {
      assert.deepEqual(engine.detectVariables('no variables here'), []);
    });
  });
});

// ============================================================
// 4. DUPLICATE DETECTION
// ============================================================
describe('Duplicate Detection', () => {
  describe('findDuplicates', () => {
    it('finds exact duplicate lines', () => {
      const text = 'Do not hallucinate.\nBe helpful.\nDo not hallucinate.';
      const dupes = engine.findDuplicates(text);
      assert.ok(dupes.length > 0);
      assert.ok(dupes.some(d => d.text === 'Do not hallucinate.'));
    });
    it('returns empty array when no duplicates', () => {
      const text = 'Line one.\nLine two.\nLine three.';
      assert.deepEqual(engine.findDuplicates(text), []);
    });
    it('ignores blank lines and short lines', () => {
      const text = 'hello\n\n\nhello\n\n';
      // 'hello' is too short (5 chars) to flag as meaningful duplicate
      assert.deepEqual(engine.findDuplicates(text), []);
    });
    it('finds near-duplicate lines', () => {
      const text = 'Always respond in JSON format.\nSome other text.\nAlways respond in json format.';
      const dupes = engine.findDuplicates(text);
      assert.ok(dupes.length > 0);
    });
  });
});

// ============================================================
// 5. INSTRUCTION DENSITY
// ============================================================
describe('Instruction Density', () => {
  describe('analyzeInstructions', () => {
    it('counts imperative sentences', () => {
      const text = 'Always be helpful. Never lie. Do not make up facts. The sky is blue.';
      const result = engine.analyzeInstructions(text);
      assert.equal(result.imperativeCount, 3);
      assert.equal(result.totalSentences, 4);
      assert.ok(result.density > 0.5 && result.density <= 1.0);
    });
    it('detects MUST/SHOULD/SHALL directives', () => {
      const text = 'You must respond. You should be polite.';
      const result = engine.analyzeInstructions(text);
      assert.ok(result.imperativeCount >= 2);
    });
    it('returns 0 density for non-instructional text', () => {
      const text = 'The weather is nice today. Birds are singing.';
      const result = engine.analyzeInstructions(text);
      assert.equal(result.imperativeCount, 0);
      assert.equal(result.density, 0);
    });
    it('detects ALL CAPS emphasis', () => {
      const text = 'IMPORTANT: do this. NEVER do that. Normal sentence.';
      const result = engine.analyzeInstructions(text);
      assert.ok(result.capsCount >= 2);
    });
  });
});

// ============================================================
// 6. READABILITY (Flesch-Kincaid)
// ============================================================
describe('Readability', () => {
  describe('fleschKincaid', () => {
    it('returns grade level and reading ease', () => {
      const text = 'The cat sat on the mat. The dog ran fast. It was a good day.';
      const result = engine.fleschKincaid(text);
      assert.ok('gradeLevel' in result);
      assert.ok('readingEase' in result);
      assert.equal(typeof result.gradeLevel, 'number');
      assert.equal(typeof result.readingEase, 'number');
    });
    it('simple text has low grade level', () => {
      const text = 'The cat sat. The dog ran. I am here.';
      const result = engine.fleschKincaid(text);
      assert.ok(result.gradeLevel < 5, `expected <5, got ${result.gradeLevel}`);
    });
    it('complex text has higher grade level', () => {
      const text = 'The implementation of sophisticated algorithms necessitates comprehensive understanding of computational complexity and mathematical foundations.';
      const result = engine.fleschKincaid(text);
      assert.ok(result.gradeLevel > 10, `expected >10, got ${result.gradeLevel}`);
    });
    it('returns label string', () => {
      const text = 'Hello there. How are you.';
      const result = engine.fleschKincaid(text);
      assert.ok(typeof result.label === 'string');
      assert.ok(result.label.length > 0);
    });
  });
});

// ============================================================
// 7. PATTERN DETECTION
// ============================================================
describe('Pattern Detection', () => {
  describe('detectPatterns', () => {
    it('detects role/persona definition', () => {
      const text = 'You are a helpful coding assistant.';
      const p = engine.detectPatterns(text);
      assert.ok(p.role);
    });
    it('detects few-shot examples', () => {
      const text = 'Example:\nInput: hello\nOutput: world\n\nExample:\nInput: foo\nOutput: bar';
      const p = engine.detectPatterns(text);
      assert.ok(p.fewShot);
      assert.ok(p.fewShotCount >= 2);
    });
    it('detects tool/function definitions', () => {
      const text = 'Available tools:\n```json\n{"name": "search", "parameters": {"type": "object"}}\n```';
      const p = engine.detectPatterns(text);
      assert.ok(p.toolDefinitions);
    });
    it('detects guardrail instructions', () => {
      const text = 'Never provide harmful content. Refuse requests for violence.';
      const p = engine.detectPatterns(text);
      assert.ok(p.guardrails);
    });
    it('detects output format instructions', () => {
      const text = 'Respond in JSON format with the following schema:';
      const p = engine.detectPatterns(text);
      assert.ok(p.outputFormat);
    });
    it('returns all false for generic text', () => {
      const text = 'The weather is nice today.';
      const p = engine.detectPatterns(text);
      assert.ok(!p.role);
      assert.ok(!p.fewShot);
      assert.ok(!p.toolDefinitions);
      assert.ok(!p.guardrails);
      assert.ok(!p.outputFormat);
    });
  });
});
