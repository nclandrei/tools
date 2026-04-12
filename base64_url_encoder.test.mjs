// TDD tests for base64_url_encoder.html
// Extract the core encode/decode functions and test them

import assert from 'node:assert';
import { describe, it } from 'node:test';

// ── Extracted functions (must match the HTML exactly) ──────────────────────

function uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Helpers that mirror the encode/decode flow in the HTML ─────────────────

function encodeText(text) {
  const raw = new TextEncoder().encode(text);
  return uint8ToBase64(raw);
}

function decodeBase64(b64str) {
  let b64 = b64str.trim();
  // Normalize URL-safe base64 (matches the HTML code)
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  // Strip whitespace (newlines, spaces, tabs) from base64 input
  b64 = b64.replace(/\s/g, '');
  while (b64.length % 4) b64 += '=';
  const bytes = base64ToUint8(b64);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function roundtrip(text) {
  return decodeBase64(encodeText(text));
}

// ── Known-good reference values (from standard base64) ─────────────────────

const KNOWN_PAIRS = [
  ['', ''],
  ['f', 'Zg=='],
  ['fo', 'Zm8='],
  ['foo', 'Zm9v'],
  ['Test', 'VGVzdA=='],
  ['Hello, World!', 'SGVsbG8sIFdvcmxkIQ=='],
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Base64 encode — known values', () => {
  for (const [input, expected] of KNOWN_PAIRS) {
    it(`encodes "${input}" to "${expected}"`, () => {
      assert.strictEqual(encodeText(input), expected);
    });
  }
});

describe('Base64 roundtrip — pipe character', () => {
  it('roundtrips a single pipe |', () => {
    assert.strictEqual(roundtrip('|'), '|');
  });

  it('roundtrips pipe in a string: foo|bar', () => {
    assert.strictEqual(roundtrip('foo|bar'), 'foo|bar');
  });

  it('roundtrips multiple pipes: a|b|c|d', () => {
    assert.strictEqual(roundtrip('a|b|c|d'), 'a|b|c|d');
  });

  it('roundtrips pipe with special chars: key=val|key2=val2', () => {
    assert.strictEqual(roundtrip('key=val|key2=val2'), 'key=val|key2=val2');
  });
});

describe('Base64 roundtrip — other special characters', () => {
  const specialChars = [
    ['backslash', '\\'],
    ['single quote', "'"],
    ['double quote', '"'],
    ['ampersand', '&'],
    ['less than', '<'],
    ['greater than', '>'],
    ['at sign', '@'],
    ['hash', '#'],
    ['percent', '%'],
    ['caret', '^'],
    ['tilde', '~'],
    ['backtick', '`'],
    ['exclamation', '!'],
    ['question mark', '?'],
    ['equals', '='],
    ['plus', '+'],
    ['slash', '/'],
    ['colon', ':'],
    ['semicolon', ';'],
    ['comma', ','],
    ['period', '.'],
    ['open paren', '('],
    ['close paren', ')'],
    ['open bracket', '['],
    ['close bracket', ']'],
    ['open brace', '{'],
    ['close brace', '}'],
    ['space', ' '],
    ['tab', '\t'],
    ['newline', '\n'],
    ['carriage return', '\r'],
    ['null byte', '\0'],
  ];

  for (const [name, char] of specialChars) {
    it(`roundtrips ${name}: ${JSON.stringify(char)}`, () => {
      assert.strictEqual(roundtrip(char), char);
    });

    it(`roundtrips ${name} in context: "before${char.replace(/\n|\r|\t|\0/g, '_')}after"`, () => {
      const input = `before${char}after`;
      assert.strictEqual(roundtrip(input), input);
    });
  }
});

describe('Base64 roundtrip — multi-byte UTF-8', () => {
  const multiByteChars = [
    ['e-acute', 'é'],
    ['euro sign', '€'],
    ['Chinese', '你好'],
    ['Japanese', 'こんにちは'],
    ['emoji', '🎉'],
    ['flag emoji', '🇺🇸'],
    ['mixed ASCII and multi-byte', 'Hello 世界! 🌍'],
  ];

  for (const [name, text] of multiByteChars) {
    it(`roundtrips ${name}: ${text}`, () => {
      assert.strictEqual(roundtrip(text), text);
    });
  }
});

describe('Base64 roundtrip — mixed content with pipes', () => {
  it('roundtrips JSON with pipes: {"sep":"|"}', () => {
    assert.strictEqual(roundtrip('{"sep":"|"}'), '{"sep":"|"}');
  });

  it('roundtrips regex-like: ^foo|bar$', () => {
    assert.strictEqual(roundtrip('^foo|bar$'), '^foo|bar$');
  });

  it('roundtrips URL with pipe: https://example.com?a=1|b=2', () => {
    const input = 'https://example.com?a=1|b=2';
    assert.strictEqual(roundtrip(input), input);
  });

  it('roundtrips multi-byte with pipe: café|naïve', () => {
    assert.strictEqual(roundtrip('café|naïve'), 'café|naïve');
  });
});

// ── Tests for whitespace-contaminated base64 input ─────────────────────────
// These simulate real-world scenarios: multiline base64 from CLI tools,
// copy-pasted base64 with stray whitespace, etc.

describe('Base64 decode — whitespace in input', () => {
  it('decodes base64 with embedded newlines (multiline base64 from CLI)', () => {
    // "Hello |test" encoded as base64, then split across lines
    const clean = encodeText('Hello |test');  // SGVsbG8gfHRlc3Q=
    const multiline = clean.slice(0, 8) + '\n' + clean.slice(8);
    assert.strictEqual(decodeBase64(multiline), 'Hello |test');
  });

  it('decodes base64 with \\r\\n line endings', () => {
    const clean = encodeText('pipe|char');
    const withCRLF = clean.slice(0, 4) + '\r\n' + clean.slice(4);
    assert.strictEqual(decodeBase64(withCRLF), 'pipe|char');
  });

  it('decodes base64 with spaces mixed in', () => {
    const clean = encodeText('foo|bar');  // Zm9vfGJhcg==
    const withSpaces = clean.slice(0, 4) + ' ' + clean.slice(4);
    assert.strictEqual(decodeBase64(withSpaces), 'foo|bar');
  });

  it('decodes base64 with tabs mixed in', () => {
    const clean = encodeText('a|b');
    const withTabs = clean.slice(0, 2) + '\t' + clean.slice(2);
    assert.strictEqual(decodeBase64(withTabs), 'a|b');
  });

  it('decodes MIME-style base64 (76-char lines)', () => {
    // Generate a long string with pipes, encode it, then add line breaks every 76 chars
    const longInput = 'data|' .repeat(50);
    const clean = encodeText(longInput);
    const mimeStyle = clean.replace(/.{76}/g, '$&\n');
    assert.strictEqual(decodeBase64(mimeStyle), longInput);
  });

  it('decodes base64 from output-box copy (leading/trailing whitespace)', () => {
    const clean = encodeText('test|pipe');
    const withWhitespace = '\n        ' + clean + '\n      ';
    assert.strictEqual(decodeBase64(withWhitespace), 'test|pipe');
  });
});
