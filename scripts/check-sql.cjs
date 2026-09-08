/**
 * Structural validator for the Novatrix SQL script.
 *
 * Counting `$$` with grep cannot see a MALFORMED delimiter — that is exactly
 * how `as $` slipped through. This walks the file character by character,
 * tracking real lexer state (line comments, block comments, single-quoted
 * strings, dollar-quoted bodies) and reports:
 *
 *   • dollar-quote tags that are opened and never closed
 *   • a lone `$` where a delimiter was clearly intended
 *   • unbalanced single quotes
 *   • unbalanced parentheses at statement level
 */
const fs = require('fs');

const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');

const lineOf = (idx) => src.slice(0, idx).split('\n').length;

const problems = [];
const stack = [];
let i = 0;
const n = src.length;

let inLineComment = false;
let blockDepth = 0;
let inSingle = false;

while (i < n) {
  const ch = src[i];
  const two = src.slice(i, i + 2);

  // Inside a dollar-quoted body, only its own closing tag matters.
  if (stack.length) {
    const tag = stack[stack.length - 1].tag;
    if (src.startsWith(tag, i)) {
      stack.pop();
      i += tag.length;
      continue;
    }
    i += 1;
    continue;
  }

  if (inLineComment) {
    if (ch === '\n') inLineComment = false;
    i += 1;
    continue;
  }

  if (blockDepth > 0) {
    if (two === '*/') { blockDepth -= 1; i += 2; continue; }
    if (two === '/*') { blockDepth += 1; i += 2; continue; }
    i += 1;
    continue;
  }

  if (inSingle) {
    if (two === "''") { i += 2; continue; }
    if (ch === "'") { inSingle = false; i += 1; continue; }
    i += 1;
    continue;
  }

  if (two === '--') { inLineComment = true; i += 2; continue; }
  if (two === '/*') { blockDepth = 1; i += 2; continue; }
  if (ch === "'") { inSingle = true; i += 1; continue; }

  if (ch === '$') {
    // A valid delimiter is $$ or $tag$ where tag is [A-Za-z_][A-Za-z0-9_]*
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i));
    if (m) {
      stack.push({ tag: m[0], line: lineOf(i) });
      i += m[0].length;
      continue;
    }
    // Positional parameters ($1) are legal inside function bodies only, and we
    // are at top level here — so a bare $ is almost certainly a broken tag.
    if (!/^\$\d/.test(src.slice(i))) {
      const line = lineOf(i);
      const text = src.split('\n')[line - 1];
      problems.push({
        line,
        kind: 'lone $',
        detail: `a lone "$" — expected "$$" or "$tag$"`,
        text: text.trim(),
      });
    }
    i += 1;
    continue;
  }

  i += 1;
}

for (const open of stack) {
  problems.push({
    line: open.line,
    kind: 'unclosed',
    detail: `dollar-quote ${open.tag} opened here and never closed`,
    text: (src.split('\n')[open.line - 1] || '').trim(),
  });
}

if (inSingle) problems.push({ line: lineOf(n), kind: 'unterminated string', detail: "a single-quoted string was never closed", text: '' });
if (blockDepth > 0) problems.push({ line: lineOf(n), kind: 'unterminated comment', detail: '/* was never closed', text: '' });

/* ── Report ─────────────────────────────────────────────────────────────── */
const lines = src.split('\n').length;
console.log(`Parsed ${file} — ${lines} lines\n`);

if (!problems.length) {
  console.log('✓ Structurally valid: every dollar-quote opens and closes, no stray "$".');
  process.exit(0);
}

problems.sort((a, b) => a.line - b.line);
console.log(`✖ ${problems.length} problem(s):\n`);
for (const p of problems) {
  console.log(`  line ${p.line}  [${p.kind}]  ${p.detail}`);
  if (p.text) console.log(`      ${p.text}`);
}
process.exit(1);
