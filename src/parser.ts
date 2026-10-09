// Tersa parser: tokens -> AST. Recursive descent with precedence climbing.
import type * as A from "./ast.js";
import { lex, type Token, type StrPart } from "./lexer.js";
import { TersaError } from "./diagnostics.js";

export function parse(src: string, file: string): A.Program {
  const p = new Parser(lex(src, file), file);
  return { file, src, decls: p.program() };
}

/** Parse a standalone expression (used for string interpolation). */
function parseExprFrom(part: StrPart, file: string): A.Expr {
  const lead = part.expr!.length - part.expr!.trimStart().length;
  const shift = part.col! - 1 + lead;
  const toks = lex(part.expr!.trim(), file).map((t) => ({
    ...t,
    col: t.line === 1 ? t.col + shift : t.col,
    end: t.line === 1 ? t.end + shift : t.end,
    line: t.line + part.line! - 1,
  }));
  const p = new Parser(toks, file);
  p.skipNewlines();
  const e = p.expr();
  p.skipNewlines();
  if (p.peek().kind !== "eof") p.fail(p.peek(), "unexpected token in string interpolation");
  return e;
}

function exprSrcHint(e: A.Expr): string {
  if (e.k === "name") return e.name;
  if (e.k === "member") return `${exprSrcHint(e.obj)}.${e.name}`;
  if (e.k === "index") return `${exprSrcHint(e.obj)}[...]`;
  return "...";
}

const COMPARE = new Set(["==", "!=", "<", "<=", ">", ">="]);
const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "//=", "%=", "**="]);

class Parser {
  i = 0;
  constructor(private toks: Token[], private file: string) {}

  // ---------- token helpers ----------
  peek(o = 0): Token { return this.toks[Math.min(this.i + o, this.toks.length - 1)]; }
  prev(): Token { return this.toks[this.i - 1]; }
  next(): Token { return this.toks[this.i++]; }
  is(v: string, o = 0): boolean { const t = this.peek(o); return (t.kind === "op" || t.kind === "kw") && t.value === v; }
  isKind(k: Token["kind"], o = 0) { return this.peek(o).kind === k; }
  accept(v: string): boolean { if (this.is(v)) { this.i++; return true; } return false; }
  fail(t: Token, msg: string, hint?: string): never {
    throw new TersaError({ code: "E002", message: msg, file: this.file, line: t.line, col: t.col, endCol: t.end, hint });
  }
  describe(t: Token): string {
    if (t.kind === "newline") return "end of line";
    if (t.kind === "indent") return "indented block";
    if (t.kind === "dedent") return "end of block";
    if (t.kind === "eof") return "end of file";
    if (t.kind === "str") return "string";
    return `'${t.value}'`;
  }
  expect(v: string, hint?: string): Token {
    if (this.is(v)) return this.next();
    const t = this.peek();
    return this.fail(t, `expected '${v}', found ${this.describe(t)}`, hint);
  }
  expectName(what = "a name"): Token {
    const t = this.peek();
    if (t.kind === "name") return this.next();
    if (t.kind === "kw") this.fail(t, `'${t.value}' is a reserved keyword and cannot be used as ${what}`, `rename it, e.g. '${t.value}_'`);
    return this.fail(t, `expected ${what}, found ${this.describe(t)}`);
  }
  skipNewlines() { while (this.isKind("newline")) this.i++; }
  pos(t: Token): A.Pos { return { line: t.line, col: t.col, end: t.end }; }
  span(start: Token): A.Pos {
    const last = this.prev();
    return { line: start.line, col: start.col, end: last.line === start.line ? last.end : start.end };
  }
  /** End of a simple statement: a newline, end of file, or the end of a block. */
  endStmt() {
    if (this.isKind("newline")) { this.i++; return; }
    if (this.isKind("eof") || this.isKind("dedent")) return;
    if (this.prev()?.kind === "dedent") return; // statement ended with an indented block
    const t = this.peek();
    this.fail(t, `expected end of line, found ${this.describe(t)}`,
      t.value === ";" ? "put each statement on its own line" : undefined);
  }

  // ---------- program ----------
  program(): A.Decl[] {
    const decls: A.Decl[] = [];
    this.skipNewlines();
    while (!this.isKind("eof")) {
      if (this.isKind("indent")) this.fail(this.peek(), "unexpected indentation", "top-level code must start at column 1");
      decls.push(this.decl());
      this.skipNewlines();
    }
    return decls;
  }

  decl(): A.Decl {
    const t = this.peek();
    if (t.kind === "kw") {
      switch (t.value) {
        case "fn": return this.fnDecl();
        case "type": return this.typeDecl();
        case "use": return this.useDecl();
        case "extern": return this.externDecl();
        case "test": {
          this.next();
          const nameTok = this.peek();
          if (nameTok.kind !== "str" || nameTok.parts!.some((p) => p.expr !== undefined)) this.fail(nameTok, "expected a test name string", 'test "adds numbers":');
          this.next();
          this.expect(":");
          const body = this.block();
          return { k: "test", name: nameTok.parts!.map((p) => p.text).join(""), body, ...this.span(t) };
        }
      }
    }
    const stmt = this.stmt();
    return { k: "stmt", stmt, line: stmt.line, col: stmt.col, end: stmt.end };
  }

  tparams(): A.TParam[] {
    const out: A.TParam[] = [];
    if (!this.accept("[")) return out;
    do {
      const n = this.expectName("a type parameter");
      let constraint: string | undefined;
      if (this.accept(":")) constraint = this.expectName("a constraint (num, ord, eq)").value;
      out.push({ name: n.value, constraint });
    } while (this.accept(","));
    this.expect("]");
    return out;
  }

  params(allowImplicitTypes = false): A.Param[] {
    const out: A.Param[] = [];
    this.expect("(");
    while (!this.is(")")) {
      const start = this.peek();
      const mutable = this.accept("var");
      const n = this.expectName("a parameter name");
      let type: A.TypeExpr | undefined;
      if (this.accept(":")) type = this.type();
      else if (!allowImplicitTypes) this.fail(this.peek(), `parameter '${n.value}' needs a type`, `write '${n.value}: int' (or the right type)`);
      let def: A.Expr | undefined;
      if (this.accept("=")) def = this.expr();
      out.push({ name: n.value, type, default: def, mutable, pos: this.span(start) });
      if (!this.accept(",")) break;
    }
    this.expect(")");
    return out;
  }

  fnDecl(): A.FnDecl {
    const start = this.expect("fn");
    let name = this.expectName("a function name").value;
    let owner: string | undefined;
    if (this.accept(".")) { owner = name; name = this.expectName("a method name").value; }
    const tparams = this.tparams();
    if (!this.is("(")) this.fail(this.peek(), `expected '(' after function name`, `fn ${name}(x: int) -> int:`);
    const params = this.params();
    let ret: A.TypeExpr | undefined;
    if (this.accept("->")) ret = this.type();
    let body: A.Block | A.Expr;
    if (this.accept("=")) {
      body = this.exprOrTuple();
      const t = this.peek();
      if (t.kind === "op" && ASSIGN_OPS.has(t.value)) {
        this.fail(t, "a '= expr' function body must be an expression, not an assignment", `use ':' for a statement body: fn ${owner ? owner + "." : ""}${name}(...): ${exprSrcHint(body)} ${t.value} ...`);
      }
      this.endStmt();
    } else {
      if (!this.is(":")) this.fail(this.peek(), `expected ':' or '=' after function signature`, "use ':' for a block body or '= expr' for a one-line body");
      this.next();
      body = this.block();
    }
    const end = this.toks[this.i - 1];
    return { k: "fn", name, owner, tparams, params, ret, body, line: start.line, col: start.col, end: start.line === end.line ? end.end : start.end };
  }

  fields(): A.FieldDecl[] {
    const out: A.FieldDecl[] = [];
    this.expect("(");
    while (!this.is(")")) {
      const start = this.peek();
      const mutable = this.accept("var");
      const n = this.expectName("a field name");
      if (!this.is(":")) this.fail(this.peek(), `field '${n.value}' needs a type`, `${n.value}: int`);
      this.next();
      const type = this.type();
      let def: A.Expr | undefined;
      if (this.accept("=")) def = this.expr();
      out.push({ name: n.value, type, mutable, default: def, pos: this.span(start) });
      if (!this.accept(",")) break;
    }
    this.expect(")");
    return out;
  }

  typeDecl(): A.Decl {
    const start = this.expect("type");
    const nameTok = this.expectName("a type name");
    const name = nameTok.value;
    if (!/^[A-Z]/.test(name)) this.fail(nameTok, `type names must start with an uppercase letter`, `type ${name[0].toUpperCase() + name.slice(1)}`);
    const tparams = this.tparams();
    if (this.is("(")) {
      const fields = this.fields();
      this.endStmt();
      return { k: "record", name, tparams, fields, ...this.span(start) };
    }
    if (!this.is("=")) this.fail(this.peek(), `expected '(' or '=' after type name`, `type ${name}(x: int) for a record, or type ${name} = A | B(x: int) for a choice`);
    this.next();
    // multi-line sum: "=" NEWLINE INDENT "|" Variant ... DEDENT
    let multiline = false;
    if (this.isKind("newline") && this.isKind("indent", 1)) { this.i += 2; multiline = true; }
    // alias if the right side clearly is a type expression rather than variants
    const t = this.peek();
    const isAlias = !this.is("|") && (
      (t.kind === "op" && (t.value === "[" || t.value === "{" || t.value === "(")) ||
      (t.kind === "kw" && t.value === "fn") ||
      (t.kind === "name" && /^[a-z]/.test(t.value)) ||
      (t.kind === "name" && this.is("[", 1))
    );
    if (isAlias) {
      if (multiline) this.fail(t, "type alias must be on one line");
      const type = this.type();
      this.endStmt();
      return { k: "alias", name, tparams, type, ...this.span(start) };
    }
    const variants: A.VariantDecl[] = [];
    this.accept("|");
    for (;;) {
      if (multiline) this.skipNewlines();
      const vs = this.peek();
      const vn = this.expectName("a variant name");
      if (!/^[A-Z]/.test(vn.value)) this.fail(vn, "variant names must start with an uppercase letter");
      let fields: A.FieldDecl[] = [];
      const hasParens = this.is("(");
      if (hasParens) fields = this.fields();
      variants.push({ name: vn.value, fields, hasParens, pos: this.span(vs) });
      if (multiline && this.isKind("newline") && this.is("|", 1)) this.i++;
      if (!this.accept("|")) break;
    }
    if (multiline) {
      this.skipNewlines();
      if (!this.isKind("dedent")) this.fail(this.peek(), "expected end of variant list");
      this.next();
    } else this.endStmt();
    return { k: "sum", name, tparams, variants, ...this.span(start) };
  }

  modulePath(): string {
    let m = this.expectName("a module name").value;
    while (this.accept(".")) m += "." + this.expectName("a module name").value;
    return m;
  }

  useDecl(): A.Decl {
    const start = this.expect("use");
    const module = this.modulePath();
    let names: string[] | undefined;
    let alias: string | undefined;
    if (this.accept(":")) {
      names = [];
      do names.push(this.expectName().value); while (this.accept(","));
    } else if (this.accept("as")) alias = this.expectName().value;
    this.endStmt();
    return { k: "use", module, names, alias, ...this.span(start) };
  }

  externDecl(): A.Decl {
    const start = this.expect("extern");
    const modTok = this.peek();
    if (modTok.kind !== "str" || modTok.parts!.some((p) => p.expr !== undefined)) this.fail(modTok, "expected a Python module name string", 'extern "math":');
    this.next();
    const module = modTok.parts!.map((p) => p.text).join("");
    this.expect(":");
    const items: A.ExternItem[] = [];
    const item = () => {
      const s = this.peek();
      if (this.is("fn")) {
        this.next();
        let name = this.expectName().value;
        let owner: string | undefined;
        if (this.accept(".")) { owner = name; name = this.expectName().value; }
        const tparams = this.tparams();
        const params = this.params();
        let ret: A.TypeExpr | undefined;
        if (this.accept("->")) ret = this.type();
        let pyName = name;
        if (this.accept("as")) pyName = this.expectName().value; // fn py_name as tersa_name
        if (pyName !== name) [name, pyName] = [pyName, name];
        items.push({ k: "fn", name, owner, tparams, params, ret, pyName, pos: this.span(s) });
      } else if (this.is("type")) {
        this.next();
        const n = this.expectName().value;
        const fields = this.is("(") ? this.fields() : [];
        items.push({ k: "type", name: n, fields, pos: this.span(s) });
      } else {
        const n = this.expectName("an extern item (fn, type, or 'name: Type')");
        this.expect(":");
        items.push({ k: "const", name: n.value, type: this.type(), pos: this.span(s) });
      }
      this.endStmt();
    };
    if (this.isKind("newline")) {
      this.next();
      if (!this.isKind("indent")) this.fail(this.peek(), "expected an indented block of extern declarations");
      this.next();
      while (!this.isKind("dedent") && !this.isKind("eof")) { item(); this.skipNewlines(); }
      if (this.isKind("dedent")) this.next();
    } else item();
    return { k: "extern", module, items, ...this.span(start) };
  }

  // ---------- blocks & statements ----------
  block(): A.Block {
    const start = this.peek();
    if (this.isKind("newline")) {
      this.next();
      if (!this.isKind("indent")) this.fail(this.peek(), "expected an indented block", "indent the body by 4 spaces");
      this.next();
      const stmts: A.Stmt[] = [];
      while (!this.isKind("dedent") && !this.isKind("eof")) {
        stmts.push(this.stmt());
        this.skipNewlines();
      }
      if (this.isKind("dedent")) this.next();
      return { stmts, pos: this.pos(start) };
    }
    // inline block: a single simple statement on the same line
    const s = this.simpleStmt(true);
    return { stmts: [s], pos: this.pos(start) };
  }

  stmt(): A.Stmt {
    const t = this.peek();
    if (t.kind === "kw") {
      switch (t.value) {
        case "while": {
          this.next();
          const cond = this.expr();
          this.expect(":", "while cond:");
          const body = this.block();
          return { k: "while", cond, body, ...this.span(t) };
        }
        case "for": {
          this.next();
          const target = this.forTarget();
          this.expect("in", "for x in items:");
          const iter = this.expr();
          this.expect(":");
          const body = this.block();
          return { k: "for", target, iter, body, ...this.span(t) };
        }
        case "fn": {
          const decl = this.fnDecl();
          return { k: "fndecl", decl, line: decl.line, col: decl.col, end: decl.end };
        }
        case "type": case "use": case "extern": case "test":
          this.fail(t, `'${t.value}' declarations are only allowed at the top level`);
      }
    }
    if (t.kind === "name" && t.value === "def") this.fail(t, "use 'fn' to define functions", "fn name(x: int) -> int:");
    if (t.kind === "name" && t.value === "class") this.fail(t, "Tersa has no classes; use 'type' for records and choices", "type Point(x: float, y: float)");
    if (t.kind === "name" && (t.value === "let" || t.value === "const")) this.fail(t, `'${t.value}' is not needed: 'x = 1' declares an immutable variable`, "use 'var x = 1' for a mutable variable");
    if (t.kind === "name" && t.value === "try") this.fail(t, "Tersa has no try/except; functions that can fail return T!E", "return ok(value) / err(\"msg\"), and use '?' to propagate");
    return this.simpleStmt(false);
  }

  forTarget(): A.Pattern {
    const start = this.peek();
    const one = (): A.Pattern => {
      const s = this.peek();
      if (this.accept("(")) {
        const els: A.Pattern[] = [];
        do els.push(one()); while (this.accept(","));
        this.expect(")");
        return { k: "ptuple", els, ...this.span(s) };
      }
      const n = this.expectName("a loop variable");
      return n.value === "_" ? { k: "pwild", ...this.pos(n) } : { k: "pbind", name: n.value, ...this.pos(n) };
    };
    const first = one();
    if (!this.is(",")) return first;
    const els = [first];
    while (this.accept(",")) els.push(one());
    return { k: "ptuple", els, ...this.span(start) };
  }

  simpleStmt(inline: boolean): A.Stmt {
    const t = this.peek();
    const done = (s: A.Stmt): A.Stmt => { if (!inline) this.endStmt(); return s; };
    if (t.kind === "kw") {
      switch (t.value) {
        case "return": {
          this.next();
          let value: A.Expr | undefined;
          if (!this.isKind("newline") && !this.isKind("dedent") && !this.isKind("eof") && !this.is("else") && !this.is("elif")) value = this.exprOrTuple();
          return done({ k: "return", value, ...this.span(t) });
        }
        case "break": this.next(); return done({ k: "break", ...this.span(t) });
        case "continue": this.next(); return done({ k: "continue", ...this.span(t) });
        case "pass": this.next(); return done({ k: "pass", ...this.span(t) });
        case "assert": {
          this.next();
          const cond = this.expr();
          let msg: A.Expr | undefined;
          if (this.accept(",")) msg = this.expr();
          return done({ k: "assert", cond, msg, ...this.span(t) });
        }
        case "var": {
          this.next();
          const target = this.forTarget();
          let type: A.TypeExpr | undefined;
          if (this.accept(":")) type = this.type();
          if (!this.is("=")) this.fail(this.peek(), "a 'var' declaration needs an initial value", "var count = 0");
          this.next();
          const value = this.exprOrTuple();
          return done({ k: "let", target, mutable: true, type, value, ...this.span(t) });
        }
        case "while": case "for": case "fn":
          if (inline) this.fail(t, `'${t.value}' cannot be written inline; put it on its own indented line`);
      }
    }
    // annotated declaration: name: Type = value
    if (t.kind === "name" && this.is(":", 1) && !inline) {
      this.next(); this.next();
      const type = this.type();
      this.expect("=", `${t.value}: <type> = <value>`);
      const value = this.exprOrTuple();
      return done({ k: "let", target: { k: "pbind", name: t.value, ...this.pos(t) }, mutable: false, type, value, ...this.span(t) });
    }
    const e = this.exprOrTuple();
    const opTok = this.peek();
    if (opTok.kind === "op" && ASSIGN_OPS.has(opTok.value)) {
      this.next();
      if (e.k === "tuple" && opTok.value !== "=") this.fail(opTok, "compound assignment needs a single target");
      const value = this.exprOrTuple();
      return done({ k: "assign", target: e, op: opTok.value, value, ...this.span(t) });
    }
    return done({ k: "expr", expr: e, ...this.span(t) });
  }

  // ---------- expressions ----------
  /** An expression, or a bare comma tuple like `a, b`. */
  exprOrTuple(): A.Expr {
    const start = this.peek();
    const first = this.expr();
    if (!this.is(",")) return first;
    const items = [first];
    while (this.accept(",")) {
      if (this.isKind("newline") || this.is("=")) break;
      items.push(this.expr());
    }
    return { k: "tuple", items, ...this.span(start) };
  }

  expr(): A.Expr { return this.or(); }

  /** `??` binds tighter than arithmetic: `m.get(k) ?? 0 + 1` means `(m.get(k) ?? 0) + 1`. */
  coalesce(): A.Expr {
    let left = this.unary();
    while (this.is("??")) {
      const op = this.next();
      const right = this.unary();
      left = { k: "binary", op: "??", left, right, line: left.line, col: left.col, end: right.line === left.line ? right.end : op.end };
    }
    return left;
  }

  bin(left: A.Expr, op: string, right: A.Expr): A.Expr {
    return { k: "binary", op, left, right, line: left.line, col: left.col, end: right.line === left.line ? right.end : left.end };
  }

  or(): A.Expr {
    let left = this.and();
    while (this.accept("or")) left = this.bin(left, "or", this.and());
    return left;
  }
  and(): A.Expr {
    let left = this.not();
    while (this.accept("and")) left = this.bin(left, "and", this.not());
    return left;
  }
  not(): A.Expr {
    if (this.is("not")) {
      const t = this.next();
      const e = this.not();
      return { k: "unary", op: "not", expr: e, line: t.line, col: t.col, end: e.end };
    }
    return this.compare();
  }
  compare(): A.Expr {
    const first = this.range();
    const parts: A.Expr[] = [first];
    const ops: string[] = [];
    for (;;) {
      const t = this.peek();
      if (t.kind === "op" && COMPARE.has(t.value)) { this.next(); ops.push(t.value); }
      else if (this.is("in")) { this.next(); ops.push("in"); }
      else if (this.is("not") && this.is("in", 1)) { this.i += 2; ops.push("not in"); }
      else if (t.kind === "name" && t.value === "is") this.fail(t, "use '==' / '!=' instead of 'is'", "x == none");
      else break;
      parts.push(this.range());
    }
    if (ops.length === 0) return first;
    // a < b < c  ==>  (a < b) and (b < c)
    let result = this.bin(parts[0], ops[0], parts[1]);
    for (let j = 1; j < ops.length; j++) result = this.bin(result, "and", this.bin(parts[j], ops[j], parts[j + 1]));
    return result;
  }
  range(): A.Expr {
    const left = this.additive();
    if (this.is("..") || this.is("..=")) {
      const inclusive = this.next().value === "..=";
      const hi = this.additive();
      return { k: "range", lo: left, hi, inclusive, line: left.line, col: left.col, end: hi.end };
    }
    return left;
  }
  additive(): A.Expr {
    let left = this.multiplicative();
    while (this.is("+") || this.is("-")) left = this.bin(left, this.next().value, this.multiplicative());
    return left;
  }
  multiplicative(): A.Expr {
    let left = this.coalesce();
    while (this.is("*") || this.is("/") || this.is("//") || this.is("%")) left = this.bin(left, this.next().value, this.coalesce());
    return left;
  }
  unary(): A.Expr {
    if (this.is("-")) {
      const t = this.next();
      const e = this.unary();
      return { k: "unary", op: "-", expr: e, line: t.line, col: t.col, end: e.end };
    }
    if (this.is("!")) this.fail(this.peek(), "use 'not' for boolean negation", "not done");
    return this.power();
  }
  power(): A.Expr {
    const base = this.postfix();
    if (this.is("**")) {
      this.next();
      const exp = this.unary(); // right-associative
      return this.bin(base, "**", exp);
    }
    return base;
  }

  postfix(): A.Expr {
    let e = this.primary();
    for (;;) {
      const t = this.peek();
      if (this.is("(") && t.line === this.prev().line) {
        this.next();
        const args: A.Arg[] = [];
        while (!this.is(")")) {
          if (this.isKind("name") && this.is("=", 1)) {
            const n = this.next().value;
            this.next();
            args.push({ name: n, value: this.expr() });
          } else {
            args.push({ value: this.expr() });
          }
          if (!this.accept(",")) break;
        }
        const close = this.expect(")");
        e = { k: "call", callee: e, args, line: e.line, col: e.col, end: close.line === e.line ? close.end : e.end };
      } else if (this.is("[")) {
        this.next();
        let lo: A.Expr | undefined, hi: A.Expr | undefined;
        if (!this.is(":")) lo = this.expr();
        if (this.accept(":")) {
          if (!this.is("]")) hi = this.expr();
          const close = this.expect("]");
          e = { k: "slice", obj: e, lo, hi, line: e.line, col: e.col, end: close.end };
        } else {
          const close = this.expect("]");
          e = { k: "index", obj: e, index: lo!, line: e.line, col: e.col, end: close.end };
        }
      } else if (this.is(".")) {
        this.next();
        const n = this.peek();
        if (n.kind === "int") { // tuple field: t.0
          this.next();
          e = { k: "index", obj: e, index: { k: "int", value: n.value, ...this.pos(n) }, line: e.line, col: e.col, end: n.end };
          continue;
        }
        const name = this.expectName("a field or method name");
        e = { k: "member", obj: e, name: name.value, line: e.line, col: e.col, end: name.end };
      } else if (this.is("?")) {
        const q = this.next();
        e = { k: "try", expr: e, line: e.line, col: e.col, end: q.end };
      } else if (this.is("!") && !this.is("=", 1)) {
        const q = this.next();
        e = { k: "unwrap", expr: e, line: e.line, col: e.col, end: q.end };
      } else if (this.is("as")) {
        this.next();
        const type = this.type();
        e = { k: "cast", expr: e, type, line: e.line, col: e.col, end: type.end };
      } else break;
    }
    return e;
  }

  /** Is the token at offset o the start of a lambda `(a, b) =>` ? */
  isLambdaParen(): boolean {
    let d = 0;
    for (let j = this.i; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.kind === "op" && (t.value === "(" || t.value === "[" || t.value === "{")) d++;
      else if (t.kind === "op" && (t.value === ")" || t.value === "]" || t.value === "}")) {
        d--;
        if (d === 0) { const n = this.toks[j + 1]; return n?.kind === "op" && n.value === "=>"; }
      } else if (t.kind === "newline" || t.kind === "eof") return false;
    }
    return false;
  }

  lambda(): A.Expr {
    const start = this.peek();
    let params: A.Param[];
    if (this.isKind("name")) {
      const n = this.next();
      params = [{ name: n.value, pos: this.pos(n) }];
    } else params = this.params(true);
    this.expect("=>");
    const body = this.expr();
    return { k: "lambda", params, body, line: start.line, col: start.col, end: body.line === start.line ? body.end : start.end };
  }

  strExpr(t: Token): A.Expr {
    const parts: (string | A.Expr)[] = t.parts!.map((p) => (p.expr !== undefined ? parseExprFrom(p, this.file) : p.text!));
    const specs = t.parts!.map((p) => p.spec);
    return { k: "str", parts, specs: specs.some((x) => x) ? specs : undefined, ...this.pos(t) };
  }

  primary(): A.Expr {
    const t = this.peek();
    switch (t.kind) {
      case "int": this.next(); return { k: "int", value: t.value, ...this.pos(t) };
      case "float": this.next(); return { k: "float", value: t.value, ...this.pos(t) };
      case "str": this.next(); return this.strExpr(t);
      case "name":
        if (this.is("=>", 1)) return this.lambda();
        this.next();
        if (t.value === "null" || t.value === "None" || t.value === "nil") this.fail(t, `use 'none' instead of '${t.value}'`);
        if (t.value === "True" || t.value === "False") this.fail(t, `use '${t.value.toLowerCase()}' instead of '${t.value}'`);
        if (t.value === "lambda") this.fail(t, "use 'x => expr' for anonymous functions");
        return { k: "name", name: t.value, ...this.pos(t) };
      case "kw":
        switch (t.value) {
          case "true": case "false": this.next(); return { k: "bool", value: t.value === "true", ...this.pos(t) };
          case "none": this.next(); return { k: "none", ...this.pos(t) };
          case "if": return this.ifExpr();
          case "match": return this.matchExpr();
          case "fn": this.fail(t, "use 'x => expr' for anonymous functions, or define a named fn on its own line");
        }
        break;
      case "op":
        switch (t.value) {
          case "(": {
            if (this.isLambdaParen()) return this.lambda();
            this.next();
            if (this.is(")")) { const c = this.next(); return { k: "tuple", items: [], line: t.line, col: t.col, end: c.end }; }
            const first = this.expr();
            if (this.is(")")) { this.next(); return first; }
            const items = [first];
            while (this.accept(",")) { if (this.is(")")) break; items.push(this.expr()); }
            const c = this.expect(")");
            return { k: "tuple", items, line: t.line, col: t.col, end: c.end };
          }
          case "[": {
            this.next();
            if (this.is("]")) { const c = this.next(); return { k: "list", items: [], line: t.line, col: t.col, end: c.end }; }
            const first = this.expr();
            if (this.is("for")) {
              const comp = this.compTail(t, first, undefined, false);
              this.expect("]");
              return comp;
            }
            const items = [first];
            while (this.accept(",")) { if (this.is("]")) break; items.push(this.expr()); }
            const c = this.expect("]");
            return { k: "list", items, line: t.line, col: t.col, end: c.end };
          }
          case "{": {
            this.next();
            if (this.is("}")) { const c = this.next(); return { k: "map", entries: [], line: t.line, col: t.col, end: c.end }; }
            const k = this.expr();
            if (!this.is(":")) this.fail(this.peek(), "expected ':' in map literal", '{"key": value}. For a set use set([a, b])');
            this.next();
            const v = this.expr();
            if (this.is("for")) {
              const comp = this.compTail(t, k, v, true);
              this.expect("}");
              return comp;
            }
            const entries: [A.Expr, A.Expr][] = [[k, v]];
            while (this.accept(",")) {
              if (this.is("}")) break;
              const k2 = this.expr();
              this.expect(":");
              entries.push([k2, this.expr()]);
            }
            const c = this.expect("}");
            return { k: "map", entries, line: t.line, col: t.col, end: c.end };
          }
        }
    }
    return this.fail(t, `expected an expression, found ${this.describe(t)}`);
  }

  compTail(start: Token, elem: A.Expr, value: A.Expr | undefined, isMap: boolean): A.Expr {
    this.expect("for");
    const target = this.forTarget();
    this.expect("in");
    const iter = this.or();
    let cond: A.Expr | undefined;
    if (this.accept("if")) cond = this.or();
    return { k: "comp", elem, value, target, iter, cond, isMap, ...this.pos(start) };
  }

  ifExpr(): A.Expr {
    const start = this.expect("if");
    const branches: { cond: A.Expr; body: A.Block }[] = [];
    let elseBlock: A.Block | undefined;
    let inline = true;
    const cond = this.expr();
    this.expect(":", "if cond:");
    if (this.isKind("newline")) inline = false;
    branches.push({ cond, body: this.block() });
    for (;;) {
      // allow elif/else on the next line at the same indentation
      if (this.isKind("newline") && (this.is("elif", 1) || this.is("else", 1))) this.next();
      if (this.accept("elif")) {
        const c = this.expr();
        this.expect(":");
        if (this.isKind("newline")) inline = false;
        branches.push({ cond: c, body: this.block() });
      } else if (this.accept("else")) {
        if (this.is("if")) this.fail(this.peek(), "use 'elif' instead of 'else if'");
        this.expect(":");
        if (this.isKind("newline")) inline = false;
        elseBlock = this.block();
        break;
      } else break;
    }
    return { k: "if", branches, else: elseBlock, inline, ...this.pos(start) };
  }

  matchExpr(): A.Expr {
    const start = this.expect("match");
    const subject = this.expr();
    this.expect(":", "match value:");
    if (!this.isKind("newline")) this.fail(this.peek(), "match arms must be on their own indented lines");
    this.next();
    if (!this.isKind("indent")) this.fail(this.peek(), "expected indented match arms");
    this.next();
    const arms: A.MatchArm[] = [];
    while (!this.isKind("dedent") && !this.isKind("eof")) {
      const s = this.peek();
      if (this.isKind("name") && s.value === "case") this.fail(s, "match arms don't use 'case'; write the pattern directly", "Circle(r): 3.14 * r * r");
      const pattern = this.pattern();
      let guard: A.Expr | undefined;
      if (this.accept("if")) guard = this.expr();
      if (this.is("=>")) this.fail(this.peek(), "use ':' after a match pattern", "Some(x): x + 1");
      this.expect(":");
      const body = this.block();
      arms.push({ pattern, guard, body, pos: this.span(s) });
      this.skipNewlines();
    }
    if (this.isKind("dedent")) this.next();
    return { k: "match", subject, arms, ...this.pos(start) };
  }

  // ---------- patterns ----------
  pattern(): A.Pattern {
    const start = this.peek();
    const first = this.patternAtom();
    if (!this.is("|")) return first;
    const alts = [first];
    while (this.accept("|")) alts.push(this.patternAtom());
    return { k: "por", alts, ...this.span(start) };
  }

  patternAtom(): A.Pattern {
    const t = this.peek();
    if (t.kind === "int" || t.kind === "float") { this.next(); return { k: "plit", value: this.primaryFrom(t), ...this.pos(t) }; }
    if (this.is("-") && (this.isKind("int", 1) || this.isKind("float", 1))) {
      this.next();
      const n = this.next();
      const lit: A.Expr = { k: "unary", op: "-", expr: this.primaryFrom(n), ...this.span(t) };
      return { k: "plit", value: lit, ...this.span(t) };
    }
    if (t.kind === "str") {
      if (t.parts!.some((p) => p.expr !== undefined)) this.fail(t, "patterns cannot contain string interpolation");
      this.next();
      return { k: "plit", value: this.strExpr(t), ...this.pos(t) };
    }
    if (this.is("true") || this.is("false")) { this.next(); return { k: "plit", value: { k: "bool", value: t.value === "true", ...this.pos(t) }, ...this.pos(t) }; }
    if (this.is("none")) { this.next(); return { k: "pnone", ...this.pos(t) }; }
    if (this.is("(")) {
      this.next();
      const els: A.Pattern[] = [];
      while (!this.is(")")) { els.push(this.pattern()); if (!this.accept(",")) break; }
      this.expect(")");
      if (els.length === 1) return els[0];
      return { k: "ptuple", els, ...this.span(t) };
    }
    if (t.kind === "name") {
      this.next();
      if (t.value === "_") return { k: "pwild", ...this.pos(t) };
      let ctorName = t.value;
      if (this.is(".") && this.isKind("name", 1) && /^[A-Z]/.test(this.peek(1).value)) {
        this.next();
        ctorName = t.value + "." + this.next().value; // module-qualified constructor: geo.Circle(r)
      }
      if (ctorName !== t.value) {
        const args: A.Pattern[] = [];
        let hasParens = false;
        if (this.is("(")) {
          hasParens = true;
          this.next();
          while (!this.is(")")) { args.push(this.pattern()); if (!this.accept(",")) break; }
          this.expect(")");
        }
        return { k: "pctor", name: ctorName, args, hasParens, ...this.span(t) };
      }
      const special = t.value === "some" || t.value === "ok" || t.value === "err";
      if (special && this.is("(")) {
        this.next();
        const inner = this.pattern();
        this.expect(")");
        const k = t.value === "some" ? "psome" : t.value === "ok" ? "pok" : "perr";
        return { k, inner, ...this.span(t) } as A.Pattern;
      }
      if (/^[A-Z]/.test(t.value)) {
        const args: A.Pattern[] = [];
        let hasParens = false;
        if (this.is("(")) {
          hasParens = true;
          this.next();
          while (!this.is(")")) { args.push(this.pattern()); if (!this.accept(",")) break; }
          this.expect(")");
        }
        return { k: "pctor", name: t.value, args, hasParens, ...this.span(t) };
      }
      return { k: "pbind", name: t.value, ...this.pos(t) };
    }
    return this.fail(t, `expected a pattern, found ${this.describe(t)}`);
  }

  primaryFrom(t: Token): A.Expr {
    return t.kind === "int" ? { k: "int", value: t.value, ...this.pos(t) } : { k: "float", value: t.value, ...this.pos(t) };
  }

  // ---------- types ----------
  type(): A.TypeExpr {
    if (this.is("!")) {
      // `!E` is shorthand for `()!E`: an action that can fail
      const bang = this.next();
      const err = this.typePostfix();
      const unit: A.TypeExpr = { k: "ttuple", els: [], ...this.pos(bang) };
      return { k: "tres", ok: unit, err, line: bang.line, col: bang.col, end: err.end };
    }
    const left = this.typePostfix();
    if (this.is("!")) {
      this.next();
      const err = this.typePostfix();
      return { k: "tres", ok: left, err, line: left.line, col: left.col, end: err.end };
    }
    return left;
  }

  typePostfix(): A.TypeExpr {
    let t = this.typeAtom();
    while (this.is("?") || this.is("??")) {
      const q = this.next();
      t = { k: "topt", inner: t, line: t.line, col: t.col, end: q.end };
      if (q.value === "??") t = { k: "topt", inner: t, line: t.line, col: t.col, end: q.end };
    }
    return t;
  }

  typeAtom(): A.TypeExpr {
    const t = this.peek();
    if (this.accept("[")) {
      const el = this.type();
      const c = this.expect("]", "list types look like [int]");
      return { k: "tlist", el, line: t.line, col: t.col, end: c.end };
    }
    if (this.accept("{")) {
      const key = this.type();
      this.expect(":", "map types look like {str: int}");
      const val = this.type();
      const c = this.expect("}");
      return { k: "tmap", key, val, line: t.line, col: t.col, end: c.end };
    }
    if (this.accept("(")) {
      const els: A.TypeExpr[] = [];
      while (!this.is(")")) { els.push(this.type()); if (!this.accept(",")) break; }
      const c = this.expect(")");
      if (els.length === 1) return els[0];
      return { k: "ttuple", els, line: t.line, col: t.col, end: c.end };
    }
    if (this.accept("fn")) {
      this.expect("(");
      const params: A.TypeExpr[] = [];
      while (!this.is(")")) { params.push(this.type()); if (!this.accept(",")) break; }
      this.expect(")");
      let ret: A.TypeExpr = { k: "ttuple", els: [], ...this.pos(this.prev()) };
      if (this.accept("->")) ret = this.type();
      return { k: "tfn", params, ret, line: t.line, col: t.col, end: ret.end };
    }
    if (t.kind === "name" || (t.kind === "kw" && t.value === "none")) {
      this.next();
      let name = t.value;
      if (this.accept(".")) name += "." + this.expectName("a type name").value;
      const args: A.TypeExpr[] = [];
      if (this.is("[")) {
        this.next();
        do args.push(this.type()); while (this.accept(","));
        this.expect("]");
      }
      return { k: "tname", name, args, ...this.span(t) };
    }
    return this.fail(t, `expected a type, found ${this.describe(t)}`, "types look like int, str, [int], {str: int}, int?, Point");
  }
}
