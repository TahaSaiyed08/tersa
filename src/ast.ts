// Tersa abstract syntax tree.
import type { Type } from "./types.js";

export interface Pos { line: number; col: number; end: number }

// ---------- type expressions (as written in source) ----------
export type TypeExpr =
  | (Pos & { k: "tname"; name: string; args: TypeExpr[] })
  | (Pos & { k: "tlist"; el: TypeExpr })
  | (Pos & { k: "tmap"; key: TypeExpr; val: TypeExpr })
  | (Pos & { k: "ttuple"; els: TypeExpr[] })
  | (Pos & { k: "topt"; inner: TypeExpr })
  | (Pos & { k: "tres"; ok: TypeExpr; err: TypeExpr })
  | (Pos & { k: "tfn"; params: TypeExpr[]; ret: TypeExpr });

// ---------- patterns ----------
export type Pattern =
  | (Pos & { k: "pwild" })
  | (Pos & { k: "pbind"; name: string })
  | (Pos & { k: "plit"; value: Expr })
  | (Pos & { k: "pnone" })
  | (Pos & { k: "pctor"; name: string; args: Pattern[]; hasParens: boolean; variant?: VariantInfoRef })
  | (Pos & { k: "psome"; inner: Pattern })
  | (Pos & { k: "pok"; inner: Pattern })
  | (Pos & { k: "perr"; inner: Pattern })
  | (Pos & { k: "ptuple"; els: Pattern[] })
  | (Pos & { k: "por"; alts: Pattern[] });

export interface VariantInfoRef { typeName: string; variant: string; pyName: string }

// ---------- expressions ----------
export interface Arg { name?: string; value: Expr }
export interface Param { name: string; type?: TypeExpr; default?: Expr; mutable?: boolean; pos: Pos }

export type Expr = Pos & { ty?: Type } & (
  | { k: "int"; value: string }
  | { k: "float"; value: string }
  | { k: "str"; parts: (string | Expr)[]; specs?: (string | undefined)[] }
  | { k: "bool"; value: boolean }
  | { k: "none" }
  | { k: "name"; name: string; ref?: NameRef }
  | { k: "list"; items: Expr[] }
  | { k: "map"; entries: [Expr, Expr][] }
  | { k: "tuple"; items: Expr[] }
  | { k: "call"; callee: Expr; args: Arg[]; resolved?: CallTarget }
  | { k: "member"; obj: Expr; name: string; memberKind?: "field" | "method" | "module" | "dyn"; pyName?: string; moduleRef?: NameRef }
  | { k: "index"; obj: Expr; index: Expr }
  | { k: "slice"; obj: Expr; lo?: Expr; hi?: Expr }
  | { k: "binary"; op: string; left: Expr; right: Expr }
  | { k: "unary"; op: string; expr: Expr }
  | { k: "lambda"; params: Param[]; body: Expr; captures?: string[] }
  | { k: "try"; expr: Expr; tryKind?: "opt" | "res" }
  | { k: "unwrap"; expr: Expr; tryKind?: "opt" | "res" }
  | { k: "if"; branches: { cond: Expr; body: Block }[]; else?: Block; inline: boolean }
  | { k: "match"; subject: Expr; arms: MatchArm[] }
  | { k: "comp"; elem: Expr; value?: Expr; target: Pattern; iter: Expr; cond?: Expr; isMap: boolean }
  | { k: "range"; lo: Expr; hi: Expr; inclusive: boolean }
  | { k: "cast"; expr: Expr; type: TypeExpr; target?: Type }
);

export interface MatchArm { pattern: Pattern; guard?: Expr; body: Block; pos: Pos }

/** What a name resolved to (filled in by the checker). */
export type NameRef =
  | { kind: "var"; pyName: string }
  | { kind: "fn"; pyName: string }
  | { kind: "builtin"; builtin: number }
  | { kind: "const"; py: string }
  | { kind: "variant"; pyName: string; nullary: boolean }
  | { kind: "record"; pyName: string };

/** What a call dispatches to (filled in by the checker). */
export type CallTarget =
  | { kind: "builtin"; builtin: number; args: Expr[]; print?: boolean } // args: final positional order incl. receiver & defaults
  | { kind: "method"; pyName: string }                          // obj.method(...) on a record/sum/extern type
  | { kind: "ufcs"; pyName: string }                            // obj.f(a) == f(obj, a) user function
  | { kind: "fn"; pyName: string }                              // direct call of a named function
  | { kind: "value" }                                           // calling a function-typed value
  | { kind: "ctor"; pyName: string; fields: string[] }          // record/variant constructor
  | { kind: "with" }                                            // record.with(field=value)
  | { kind: "dyn" };                                            // call on a dyn value

// ---------- statements ----------
export type Stmt = Pos & (
  | { k: "expr"; expr: Expr }
  | { k: "let"; target: Pattern; mutable: boolean; type?: TypeExpr; value: Expr; declares?: string[] }
  | { k: "assign"; target: Expr; op: string; value: Expr }
  | { k: "while"; cond: Expr; body: Block }
  | { k: "for"; target: Pattern; iter: Expr; body: Block }
  | { k: "return"; value?: Expr }
  | { k: "break" }
  | { k: "continue" }
  | { k: "assert"; cond: Expr; msg?: Expr }
  | { k: "pass" }
  | { k: "fndecl"; decl: FnDecl }
);

export type FnDecl = Extract<Decl, { k: "fn" }>;

export interface Block { stmts: Stmt[]; pos: Pos }

// ---------- top-level declarations ----------
export interface FieldDecl { name: string; type: TypeExpr; mutable: boolean; default?: Expr; pos: Pos }
export interface VariantDecl { name: string; fields: FieldDecl[]; hasParens: boolean; pos: Pos }

export type Decl = Pos & (
  | { k: "fn"; name: string; owner?: string; tparams: TParam[]; params: Param[]; ret?: TypeExpr; body: Block | Expr; doc?: string;
      usesTry?: boolean; implicitOk?: boolean; nonlocals?: Set<string>; globals?: Set<string> }
  | { k: "record"; name: string; tparams: TParam[]; fields: FieldDecl[]; doc?: string }
  | { k: "sum"; name: string; tparams: TParam[]; variants: VariantDecl[]; doc?: string }
  | { k: "alias"; name: string; tparams: TParam[]; type: TypeExpr }
  | { k: "use"; module: string; names?: string[]; alias?: string }
  | { k: "extern"; module: string; items: ExternItem[] }
  | { k: "test"; name: string; body: Block }
  | { k: "stmt"; stmt: Stmt }
);

export interface TParam { name: string; constraint?: string }

export type ExternItem =
  | { k: "fn"; name: string; owner?: string; tparams: TParam[]; params: Param[]; ret?: TypeExpr; pyName: string; pos: Pos }
  | { k: "type"; name: string; fields: FieldDecl[]; pos: Pos }
  | { k: "const"; name: string; type: TypeExpr; pos: Pos };

export interface Program { file: string; src: string; decls: Decl[] }
