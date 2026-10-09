// Tersa lexer: turns source text into tokens, including INDENT/DEDENT for blocks.
import { TersaError } from "./diagnostics.js";

export type TokKind =
  | "name" | "int" | "float" | "str" | "op" | "kw"
  | "newline" | "indent" | "dedent" | "eof";

export interface StrPart {
  // literal text, or an interpolated expression's source with its position
  text?: string;
  expr?: string;
  spec?: string; // Python-style format spec after ':' e.g. "{x:.2f}"
  line?: number;
  col?: number;
}

export interface Token {
  kind: TokKind;
  value: string;
  line: number;
  col: number;
  end: number; // column just past the token (same line)
  parts?: StrPart[]; // for strings
}

export const KEYWORDS = new Set([
  "fn", "var", "type", "if", "elif", "else", "match", "for", "in", "while",
  "break", "continue", "return", "true", "false", "none", "and", "or", "not",
  "test", "assert", "use", "extern", "as", "pass",
]);

// Longest first so that "..=" wins over "..", "//=" over "//", etc.
const OPS = [
  "..=", "//=", "**=",
  "->", "=>", "==", "!=", "<=", ">=", "??", "..", "//", "**", "+=", "-=", "*=", "/=", "%=",
  "+", "-", "*", "/", "%", "<", ">", "=", "(", ")", "[", "]", "{", "}", ",", ":", ".", "?", "!", "|",
];

export function lex(src: string, file: string): Token[] {
  const toks: Token[] = [];
  const indents = [0];
  let depth = 0; // bracket nesting; newlines inside brackets are ignored
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let atLineStart = true;

  const err = (msg: string, l = line, c = i - lineStart + 1, hint?: string): never => {
    throw new TersaError({ code: "E001", message: msg, file, line: l, col: c, hint });
  };
  const push = (kind: TokKind, value: string, startIdx: number, extra?: Partial<Token>) => {
    toks.push({ kind, value, line, col: startIdx - lineStart + 1, end: i - lineStart + 1, ...extra });
  };

  while (i <= src.length) {
    if (atLineStart && depth === 0) {
      // measure indentation
      let col = 0;
      let j = i;
      while (j < src.length && (src[j] === " " || src[j] === "\t")) {
        if (src[j] === "\t") err("tabs are not allowed for indentation; use 4 spaces", line, j - lineStart + 1);
        col++;
        j++;
      }
      // blank or comment-only line: skip without affecting indentation
      if (j >= src.length || src[j] === "\n" || src[j] === "\r" || src[j] === "#") {
        while (j < src.length && src[j] !== "\n") j++;
        if (j >= src.length) { i = j; atLineStart = false; continue; }
        i = j + 1; line++; lineStart = i;
        continue;
      }
      i = j;
      atLineStart = false;
      const top = indents[indents.length - 1];
      if (col > top) {
        indents.push(col);
        push("indent", "", i);
      } else if (col < top) {
        while (indents.length > 1 && col < indents[indents.length - 1]) {
          indents.pop();
          push("dedent", "", i);
        }
        if (col !== indents[indents.length - 1]) {
          err("indentation does not match any outer block", line, col + 1, "indent with multiples of 4 spaces, consistently");
        }
      }
    }
    if (i >= src.length) break;
    const c = src[i];

    if (c === "\n") {
      if (depth === 0) {
        const last = toks[toks.length - 1];
        if (last && last.kind !== "newline" && last.kind !== "indent" && last.kind !== "dedent") push("newline", "", i);
        atLineStart = true;
      }
      i++; line++; lineStart = i;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "\\" && src[i + 1] === "\n") { i += 2; line++; lineStart = i; continue; } // line continuation

    const start = i;
    // raw strings: r"..." and r"""...""" have no escapes and no interpolation
    if (c === "r" && src[i + 1] === '"') {
      const startLine = line;
      const startCol = i - lineStart + 1;
      const q = src.startsWith('"""', i + 1) ? '"""' : '"';
      const close = src.indexOf(q, i + 1 + q.length);
      if (close < 0) err("unterminated raw string", startLine, startCol);
      const text = src.slice(i + 1 + q.length, close);
      if (q === '"' && text.includes("\n")) err("unterminated raw string (newline inside)", startLine, startCol, 'use r"""...""" for multi-line raw strings');
      for (let k = i; k < close; k++) if (src[k] === "\n") { line++; lineStart = k + 1; }
      i = close + q.length;
      toks.push({ kind: "str", value: "", line: startLine, col: startCol, end: i - lineStart + 1, parts: [{ text }] });
      continue;
    }
    // names / keywords
    if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      const w = src.slice(start, i);
      push(KEYWORDS.has(w) ? "kw" : "name", w, start);
      continue;
    }
    // numbers
    if (/[0-9]/.test(c)) {
      let isFloat = false;
      if (c === "0" && /[xob]/.test(src[i + 1] ?? "")) {
        i += 2;
        while (i < src.length && /[0-9A-Fa-f_]/.test(src[i])) i++;
      } else {
        while (i < src.length && /[0-9_]/.test(src[i])) i++;
        // a '.' followed by a digit makes a float; ".." is a range operator
        if (src[i] === "." && /[0-9]/.test(src[i + 1] ?? "")) {
          isFloat = true;
          i++;
          while (i < src.length && /[0-9_]/.test(src[i])) i++;
        }
        if (/[eE]/.test(src[i] ?? "") && /[0-9+-]/.test(src[i + 1] ?? "")) {
          isFloat = true;
          i++;
          if (src[i] === "+" || src[i] === "-") i++;
          while (i < src.length && /[0-9]/.test(src[i])) i++;
        }
      }
      push(isFloat ? "float" : "int", src.slice(start, i).replace(/_/g, ""), start);
      continue;
    }
    // strings
    if (c === '"') {
      const triple = src.startsWith('"""', i);
      const startLine = line;
      const startCol = i - lineStart + 1;
      i += triple ? 3 : 1;
      const parts: StrPart[] = [];
      let buf = "";
      for (;;) {
        if (i >= src.length) err("unterminated string", startLine, startCol, 'close the string with "');
        const ch = src[i];
        if (triple ? src.startsWith('"""', i) : ch === '"') { i += triple ? 3 : 1; break; }
        if (ch === "\n") {
          if (!triple) err("unterminated string (newline inside a string)", startLine, startCol, 'use "\\n" or a """triple-quoted""" string');
          buf += "\n"; i++; line++; lineStart = i; continue;
        }
        if (ch === "\\") {
          const n = src[i + 1];
          const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "0": "\0", "{": "{", "}": "}" };
          if (n in map) { buf += map[n]; i += 2; continue; }
          if (n === "u" && src[i + 2] === "{") {
            const close = src.indexOf("}", i + 3);
            if (close < 0) err("bad unicode escape, expected \\u{XXXX}");
            buf += String.fromCodePoint(parseInt(src.slice(i + 3, close), 16));
            i = close + 1; continue;
          }
          err(`unknown escape \\${n}`, line, i - lineStart + 1);
        }
        if (ch === "{" && src[i + 1] === "{") { buf += "{"; i += 2; continue; }
        if (ch === "}" && src[i + 1] === "}") { buf += "}"; i += 2; continue; }
        if (ch === "{") {
          if (buf) { parts.push({ text: buf }); buf = ""; }
          const exprLine = line;
          const exprCol = i - lineStart + 2;
          let d = 1;
          let j = i + 1;
          while (j < src.length && d > 0) {
            if (src[j] === "{") d++;
            else if (src[j] === "}") d--;
            else if (src[j] === '"') { // skip nested string
              j++;
              while (j < src.length && src[j] !== '"') { if (src[j] === "\\") j++; j++; }
            } else if (src[j] === "\\" || src[j] === "\n") {
              err("'{' starts an interpolation here", exprLine, exprCol - 1, 'write {{ and }} for literal braces, or use a raw string r"..." (no interpolation, no escapes)');
            }
            if (d > 0) j++;
          }
          if (d > 0) err("unclosed '{' in string interpolation", exprLine, exprCol - 1, 'write {{ for a literal brace, or use a raw string r"..."');
          const exprSrc = src.slice(i + 1, j);
          if (!exprSrc.trim()) err("empty interpolation {}", exprLine, exprCol - 1, "write {{}} for literal braces");
          const { expr: ex, spec } = splitSpec(exprSrc);
          parts.push({ expr: ex, spec, line: exprLine, col: exprCol });
          i = j + 1;
          continue;
        }
        if (ch === "}") err("single '}' in string", line, i - lineStart + 1, "write }} for a literal brace");
        buf += ch;
        i++;
      }
      if (buf || parts.length === 0) parts.push({ text: buf });
      toks.push({ kind: "str", value: "", line: startLine, col: startCol, end: i - lineStart + 1, parts });
      continue;
    }
    if (c === "'") err("strings use double quotes", line, i - lineStart + 1, `write "..." instead of '...'`);
    if (c === "&" && src[i + 1] === "&") err("use 'and' instead of '&&'", line, i - lineStart + 1);
    if (c === "|" && src[i + 1] === "|") err("use 'or' instead of '||'", line, i - lineStart + 1);
    // operators
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      i += op.length;
      if (op === "(" || op === "[" || op === "{") depth++;
      if (op === ")" || op === "]" || op === "}") depth = Math.max(0, depth - 1);
      push("op", op, start);
      continue;
    }
    err(`unexpected character '${c}'`);
  }
  const last = toks[toks.length - 1];
  if (last && last.kind !== "newline" && last.kind !== "dedent") toks.push({ kind: "newline", value: "", line, col: i - lineStart + 1, end: i - lineStart + 1 });
  while (indents.length > 1) { indents.pop(); toks.push({ kind: "dedent", value: "", line, col: 1, end: 1 }); }
  toks.push({ kind: "eof", value: "", line, col: 1, end: 1 });
  return toks;
}

const SPEC_RE = /^[<>^=]?[+\- ]?#?0?\d*[,_]?(\.\d+)?[bcdeEfFgGnosxX%]?$/;

/** Split "expr:spec" at the last top-level ':' when the tail is a valid format spec. */
function splitSpec(src: string): { expr: string; spec?: string } {
  let depth = 0;
  let inStr = false;
  let last = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ":" && depth === 0) last = i;
  }
  if (last < 0) return { expr: src };
  const spec = src.slice(last + 1);
  if (!spec || !SPEC_RE.test(spec)) return { expr: src };
  return { expr: src.slice(0, last), spec };
}
