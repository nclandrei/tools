// Prompt Inspector Engine — pure analysis functions
// Works in both Node (require) and browser (script tag)
(function(exports) {
  'use strict';

  // === Pricing & Context Data ===
  var MODEL_DATA = {
    'claude-opus':    { inputPer1M: 15.00, contextWindow: 200000 },
    'claude-sonnet':  { inputPer1M: 3.00,  contextWindow: 200000 },
    'claude-haiku':   { inputPer1M: 0.80,  contextWindow: 200000 },
    'gpt-4o':         { inputPer1M: 2.50,  contextWindow: 128000 },
    'gpt-4o-mini':    { inputPer1M: 0.15,  contextWindow: 128000 },
    'gpt-4.1':        { inputPer1M: 2.00,  contextWindow: 1047576 },
    'gemini-pro':     { inputPer1M: 1.25,  contextWindow: 1000000 },
    'gemini-flash':   { inputPer1M: 0.15,  contextWindow: 1000000 },
  };

  var HTML_TAGS = new Set([
    'div','span','p','a','b','i','u','em','strong','br','hr','img','ul','ol','li',
    'h1','h2','h3','h4','h5','h6','table','tr','td','th','thead','tbody','pre',
    'code','blockquote','form','input','button','label','select','option','textarea',
    'section','article','nav','header','footer','main','head','body','html','meta',
    'link','script','style','title',
  ]);

  // === Size Metrics ===
  exports.countChars = function(text) {
    return [...text].length;
  };

  exports.countWords = function(text) {
    if (!text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  };

  exports.countSentences = function(text) {
    if (!text.trim()) return 0;
    // Remove common abbreviations to avoid false splits
    var cleaned = text
      .replace(/\b(e\.g)\./gi, 'eg\u0000')
      .replace(/\b(i\.e)\./gi, 'ie\u0000')
      .replace(/\b(vs|etc|Dr|Mr|Mrs|Ms|Jr|Sr|St|Prof|Inc|Ltd|Corp)\./gi, '$1\u0000');
    var matches = cleaned.match(/[.!?]+/g);
    return matches ? matches.length : 1;
  };

  exports.countLines = function(text) {
    if (text === '') return 0;
    return text.split('\n').length;
  };

  exports.countBlankLines = function(text) {
    if (text === '') return 0;
    return text.split('\n').filter(function(l) { return l.trim() === ''; }).length;
  };

  exports.estimateTokens = function(text) {
    if (!text.trim()) return 0;
    // Hybrid heuristic: words * 1.33 averaged with chars / 4
    var words = exports.countWords(text);
    var chars = text.length;
    return Math.round((words * 1.33 + chars / 4) / 2);
  };

  exports.estimateCost = function(tokens, model) {
    if (tokens === 0) return 0;
    var data = MODEL_DATA[model];
    if (!data) return 0;
    return (tokens / 1000000) * data.inputPer1M;
  };

  exports.contextWindowPercent = function(tokens, model) {
    if (tokens === 0) return 0;
    var data = MODEL_DATA[model];
    if (!data) return 0;
    return (tokens / data.contextWindow) * 100;
  };

  // === Structural Analysis ===
  exports.extractHeadings = function(text) {
    if (!text) return [];
    var lines = text.split('\n');
    var headings = [];
    var inCodeBlock = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^```/.test(line)) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;
      var match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        headings.push({
          level: match[1].length,
          text: match[2].trim(),
          line: i + 1,
        });
      }
    }
    return headings;
  };

  exports.detectXmlTags = function(text) {
    if (!text) return [];
    var matches = text.match(/<\/?([a-zA-Z][\w-]*)[^>]*>/g);
    if (!matches) return [];
    var seen = new Set();
    var tags = [];
    for (var j = 0; j < matches.length; j++) {
      var m = matches[j].match(/<\/?([a-zA-Z][\w-]*)/);
      if (m) {
        var tag = m[1].toLowerCase();
        if (!HTML_TAGS.has(tag) && !seen.has(tag)) {
          seen.add(tag);
          tags.push(tag);
        }
      }
    }
    return tags;
  };

  exports.countMarkdownElements = function(text) {
    if (!text) return { codeBlocks: 0, listItems: 0, links: 0, bold: 0, italic: 0 };
    var codeBlocks = (text.match(/^```/gm) || []).length;
    codeBlocks = Math.floor(codeBlocks / 2);
    var listItems = (text.match(/^[\t ]*[-*+]\s/gm) || []).length
                  + (text.match(/^[\t ]*\d+\.\s/gm) || []).length;
    var links = (text.match(/\[([^\]]+)\]\([^)]+\)/g) || []).length;
    var bold = (text.match(/\*\*[^*]+\*\*/g) || []).length;
    // Italic: single * not preceded/followed by *, avoiding bold matches
    var italic = (text.match(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g) || []).length;
    return { codeBlocks: codeBlocks, listItems: listItems, links: links, bold: bold, italic: italic };
  };

  // === Variable/Placeholder Detection ===
  exports.detectVariables = function(text) {
    if (!text) return [];
    var seen = new Set();
    var vars = [];
    // {{var}}
    var m1 = text.match(/\{\{[\w]+\}\}/g) || [];
    // {var} but not {{var}} — single braces with simple word
    var m2 = text.match(/(?<!\{)\{([a-zA-Z_]\w*)\}(?!\})/g) || [];
    // ${var}
    var m3 = text.match(/\$\{[\w]+\}/g) || [];
    // __VAR__
    var m4 = text.match(/__[A-Z][A-Z0-9_]+__/g) || [];
    var all = m1.concat(m2, m3, m4);
    for (var i = 0; i < all.length; i++) {
      if (!seen.has(all[i])) {
        seen.add(all[i]);
        vars.push(all[i]);
      }
    }
    return vars;
  };

  // === Duplicate Detection ===
  function bigrams(s) {
    var set = new Set();
    var lower = s.toLowerCase();
    for (var i = 0; i < lower.length - 1; i++) {
      set.add(lower.substring(i, i + 2));
    }
    return set;
  }

  function similarity(a, b) {
    var ba = bigrams(a);
    var bb = bigrams(b);
    var intersection = 0;
    ba.forEach(function(x) { if (bb.has(x)) intersection++; });
    return (2 * intersection) / (ba.size + bb.size);
  }

  exports.findDuplicates = function(text) {
    if (!text) return [];
    var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 15; });
    var dupes = [];
    var flagged = new Set();
    for (var i = 0; i < lines.length; i++) {
      if (flagged.has(i)) continue;
      for (var j = i + 1; j < lines.length; j++) {
        if (flagged.has(j)) continue;
        if (lines[i].toLowerCase() === lines[j].toLowerCase() || similarity(lines[i], lines[j]) > 0.8) {
          if (!flagged.has(i)) {
            dupes.push({ text: lines[i], lines: [i + 1, j + 1] });
            flagged.add(i);
            flagged.add(j);
          }
        }
      }
    }
    return dupes;
  };

  // === Instruction Density ===
  function splitSentences(text) {
    var cleaned = text
      .replace(/\b(e\.g|i\.e|vs|etc|Dr|Mr|Mrs|Ms|Jr|Sr|St|Prof|Inc|Ltd|Corp)\./gi, '$1\u0000');
    var sentences = cleaned.split(/(?<=[.!?])\s+/);
    return sentences.map(function(s) { return s.replace(/\u0000/g, '.').trim(); }).filter(function(s) { return s.length > 0; });
  }

  exports.analyzeInstructions = function(text) {
    if (!text.trim()) return { imperativeCount: 0, totalSentences: 0, density: 0, capsCount: 0 };
    var sentences = splitSentences(text);
    var imperativeCount = 0;
    var capsCount = 0;
    var imperativePatterns = [
      /^(always|never|do not|don't|ensure|make sure|remember|avoid|include|exclude|use|provide|respond|reply|answer|return|output|format|follow|keep|maintain|consider|check|verify|validate|ignore|skip|omit|refrain)\b/i,
      /\b(must|shall|should|have to|need to|required to)\b/i,
      /^(IMPORTANT|CRITICAL|NOTE|WARNING|RULE|CONSTRAINT)\b/,
    ];
    for (var i = 0; i < sentences.length; i++) {
      var s = sentences[i];
      for (var p = 0; p < imperativePatterns.length; p++) {
        if (imperativePatterns[p].test(s)) {
          imperativeCount++;
          break;
        }
      }
      // ALL CAPS words (3+ chars)
      var capsWords = s.match(/\b[A-Z]{3,}\b/g);
      if (capsWords) capsCount += capsWords.length;
    }
    return {
      imperativeCount: imperativeCount,
      totalSentences: sentences.length,
      density: sentences.length > 0 ? imperativeCount / sentences.length : 0,
      capsCount: capsCount,
    };
  };

  // === Readability (Flesch-Kincaid) ===
  function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 2) return 1;
    word = word.replace(/e$/, '');
    var vowelGroups = word.match(/[aeiouy]+/g);
    var count = vowelGroups ? vowelGroups.length : 1;
    return Math.max(count, 1);
  }

  exports.fleschKincaid = function(text) {
    if (!text.trim()) return { gradeLevel: 0, readingEase: 0, label: 'N/A' };
    var sentences = splitSentences(text);
    var sentenceCount = Math.max(sentences.length, 1);
    var words = text.trim().split(/\s+/).filter(function(w) { return w.replace(/[^a-zA-Z0-9]/g, '').length > 0; });
    var wordCount = Math.max(words.length, 1);
    var totalSyllables = 0;
    for (var i = 0; i < words.length; i++) {
      totalSyllables += countSyllables(words[i]);
    }
    var gradeLevel = 0.39 * (wordCount / sentenceCount) + 11.8 * (totalSyllables / wordCount) - 15.59;
    var readingEase = 206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (totalSyllables / wordCount);
    gradeLevel = Math.round(gradeLevel * 10) / 10;
    readingEase = Math.round(readingEase * 10) / 10;

    var label;
    if (readingEase >= 80) label = 'Very Easy';
    else if (readingEase >= 60) label = 'Standard';
    else if (readingEase >= 40) label = 'Difficult';
    else if (readingEase >= 20) label = 'Very Difficult';
    else label = 'Extremely Difficult';

    return { gradeLevel: gradeLevel, readingEase: readingEase, label: label };
  };

  // === Pattern Detection ===
  exports.detectPatterns = function(text) {
    if (!text) return { role: false, fewShot: false, fewShotCount: 0, toolDefinitions: false, guardrails: false, outputFormat: false };
    var lower = text.toLowerCase();

    // Role/persona
    var role = /\b(you are|act as|your role|your persona|you're a|you will act|you will be|assume the role)\b/i.test(text);

    // Few-shot examples
    var fewShotMarkers = text.match(/\b(example|input|output|user|assistant|question|answer)\s*:/gi) || [];
    var exampleBlocks = text.match(/\bexample\b/gi) || [];
    var fewShot = fewShotMarkers.length >= 4 || exampleBlocks.length >= 2;
    var fewShotCount = Math.max(Math.floor(fewShotMarkers.length / 2), exampleBlocks.length);

    // Tool/function definitions
    var toolDefinitions = /\b(function|tool|tools|functions)\b/i.test(text)
      && (/\"name\"\s*:/i.test(text) || /\"parameters\"\s*:/i.test(text) || /\"type\"\s*:\s*\"object\"/i.test(text));

    // Guardrails
    var guardrails = /\b(never|refuse|reject|decline|do not|don't|must not|harmful|dangerous|inappropriate|offensive|illegal|unsafe|unethical)\b/i.test(text)
      && (/\b(content|request|respond|response|provide|generate|output|information)\b/i.test(text));

    // Output format
    var outputFormat = /\b(respond|reply|output|format|return|answer)\b.*\b(json|xml|yaml|markdown|csv|html|plain text|structured|schema)\b/i.test(text)
      || /\b(json|xml|yaml|csv)\s*(format|schema|object|output)\b/i.test(text);

    return {
      role: role,
      fewShot: fewShot,
      fewShotCount: fewShotCount,
      toolDefinitions: toolDefinitions,
      guardrails: guardrails,
      outputFormat: outputFormat,
    };
  };

  // === Convenience: Full Analysis ===
  exports.analyze = function(text) {
    var tokens = exports.estimateTokens(text);
    return {
      chars: exports.countChars(text),
      words: exports.countWords(text),
      sentences: exports.countSentences(text),
      lines: exports.countLines(text),
      blankLines: exports.countBlankLines(text),
      tokens: tokens,
      headings: exports.extractHeadings(text),
      xmlTags: exports.detectXmlTags(text),
      markdown: exports.countMarkdownElements(text),
      variables: exports.detectVariables(text),
      duplicates: exports.findDuplicates(text),
      instructions: exports.analyzeInstructions(text),
      readability: exports.fleschKincaid(text),
      patterns: exports.detectPatterns(text),
    };
  };

})(typeof module !== 'undefined' ? module.exports : (window.PromptInspector = {}));
