// Tersa type checker. Catches the mistakes LLMs commonly make, before the code ever runs,
// and explains each one with a concrete fix.
import type * as A from "./ast.js";
import { type Diagnostic, closest } from "./diagnostics.js";
import { BUILTINS, CONSTANTS, PY_RESERVED, PY_KEYWORDS } from "./builtins.js";
import { parse } from "./parser.js";
import {
  type Type, INT, FLOAT, STR, BOOL, UNIT, DYN, NEVER, list, map, opt, res, tuple, fnType, fresh, prune, resolve,
  show, unify, assign, subst, satisfies, isHashable, setHashableNamed,
} from "./types.js";

// ---------------------------------------------------------------------------------------------
// Symbol tables

export interface SigParam { name: string; type: Type; hasDefault: boolean; mutable: boolean; default?: A.Expr }
export interface FnSig {
  name: string;
  pyName: string;
  tparams: A.TParam[];
  params: SigParam[];
  ret: Type;
  builtin?: number;     // index into BUILTINS
  variadic?: boolean;
  pure?: boolean;
  mut?: boolean;
  /** set when the return type is omitted and must be inferred from the body */
  infer?: { state: "pending" | "checking" | "done"; decl: A.FnDecl; scope: () => Scope; reported?: boolean };
}
export interface FieldInfo { name: string; type: Type; mutable: boolean; hasDefault: boolean }
export interface RecordInfo {
  kind: "record"; id: string; name: string; pyName: string; tparams: A.TParam[];
  fields: FieldInfo[]; methods: Map<string, FnSig>; extern?: boolean; decl?: A.Decl;
}
export interface SumInfo {
  kind: "sum"; id: string; name: string; pyName: string; tparams: A.TParam[];
  variants: VariantInfo[]; methods: Map<string, FnSig>; decl?: A.Decl;
}
export interface VariantInfo { name: string; pyName: string; sum: SumInfo; fields: FieldInfo[]; hasParens: boolean }
export interface AliasInfo { kind: "alias"; name: string; tparams: A.TParam[]; type: Type }
export type TypeInfo = RecordInfo | SumInfo | AliasInfo;

export type ValueEntry =
  | { k: "fn"; sig: FnSig }
  | { k: "record"; info: RecordInfo }
  | { k: "variant"; info: VariantInfo }
  | { k: "global"; v: VarInfo }
  | { k: "const"; type: Type; py: string }
  | { k: "module"; mod: ModuleExports; alias: string };

export interface ModuleExports {
  name: string;        // tersa module path, e.g. "lib.geometry"
  pyModule: string;    // python module path, e.g. "lib.geometry_tsa"
  values: Map<string, ValueEntry>;
  types: Map<string, TypeInfo>;
}

interface VarInfo {
  name: string; pyName: string; type: Type; mutable: boolean; ctx: FnCtx; used: boolean;
  pos: A.Pos; isGlobal: boolean; inLoop: boolean; isParam: boolean; origin?: VarInfo; fieldOwner?: string;
  aliasOf?: string; // declared as `x = other` where other is a list/map/set: both names share one object
}

interface FnCtx {
  id: number;
  ret: Type | null;            // null at top level
  isLambda: boolean;
  isTop: boolean;
  decl?: A.FnDecl;
  lambda?: Extract<A.Expr, { k: "lambda" }>;
  usesTry: boolean;
  tparams: Map<string, Type>;
  loopDepth: number;
  locals: VarInfo[];
  name: string;
  globals: Set<string>;
  nonlocals: Set<string>;
  inferred?: { types: { t: Type; at: A.Pos }[]; opt: boolean; err?: Type };
}

class Scope {
  vars = new Map<string, VarInfo>();
  narrow = false; // holds only narrowed copies; declarations go to the enclosing scope
  constructor(public ctx: FnCtx, public parent?: Scope, public isLoop = false) {}
  lookup(name: string): VarInfo | undefined {
    for (let s: Scope | undefined = this; s; s = s.parent) {
      const v = s.vars.get(name);
      if (v) return v;
    }
    return undefined;
  }
  inLoop(): boolean {
    for (let s: Scope | undefined = this; s && s.ctx === this.ctx; s = s.parent) if (s.isLoop) return true;
    return false;
  }
  child(isLoop = false): Scope { return new Scope(this.ctx, this, isLoop); }
}

// ---------------------------------------------------------------------------------------------
// Builtins (parsed once from their Tersa signatures)

let BUILTIN_SIGS: Map<string, FnSig[]> | undefined;
let BUILTIN_CONSTS: Map<string, { type: Type; py: string }> | undefined;

function builtinTable(): Map<string, FnSig[]> {
  if (BUILTIN_SIGS) return BUILTIN_SIGS;
  BUILTIN_SIGS = new Map();
  BUILTINS.forEach((b, idx) => {
    const prog = parse(`fn ${b.sig} = 0`, "<builtin>");
    const d = prog.decls[0] as A.FnDecl;
    const tmap = new Map<string, Type>();
    for (const tp of d.tparams) tmap.set(tp.name, { k: "param", name: tp.name, constraint: tp.constraint });
    const conv = (te: A.TypeExpr) => simpleType(te, tmap);
    const sig: FnSig = {
      name: d.name, pyName: d.name, tparams: d.tparams,
      params: d.params.map((p) => ({ name: p.name, type: conv(p.type!), hasDefault: !!p.default, mutable: !!p.mutable, default: p.default })),
      ret: d.ret ? conv(d.ret) : UNIT,
      builtin: idx, variadic: d.name === "print", pure: b.pure, mut: b.mut,
    };
    const arr = BUILTIN_SIGS!.get(d.name) ?? [];
    arr.push(sig);
    BUILTIN_SIGS!.set(d.name, arr);
  });
  return BUILTIN_SIGS;
}

function builtinConsts() {
  if (BUILTIN_CONSTS) return BUILTIN_CONSTS;
  BUILTIN_CONSTS = new Map(CONSTANTS.map((c) => [c.name, { type: c.type === "float" ? FLOAT : INT, py: c.py }]));
  return BUILTIN_CONSTS;
}

/** Type conversion for builtin signatures (no user types). */
function simpleType(te: A.TypeExpr, tmap: Map<string, Type>): Type {
  switch (te.k) {
    case "tlist": return list(simpleType(te.el, tmap));
    case "tmap": return map(simpleType(te.key, tmap), simpleType(te.val, tmap));
    case "ttuple": return tuple(te.els.map((e) => simpleType(e, tmap)));
    case "topt": return opt(simpleType(te.inner, tmap));
    case "tres": return res(simpleType(te.ok, tmap), simpleType(te.err, tmap));
    case "tfn": return fnType(te.params.map((p) => simpleType(p, tmap)), simpleType(te.ret, tmap));
    case "tname": {
      const prim: Record<string, Type> = { int: INT, float: FLOAT, str: STR, bool: BOOL, dyn: DYN, never: NEVER };
      if (prim[te.name]) return prim[te.name];
      if (te.name === "set") return { k: "set", el: simpleType(te.args[0], tmap) };
      const t = tmap.get(te.name);
      if (!t) throw new Error("bad builtin type " + te.name);
      return t;
    }
  }
}

export function pyId(name: string): string {
  return PY_RESERVED.has(name) ? name + "_" : name;
}
export function pyAttr(name: string): string {
  return PY_KEYWORDS.has(name) ? name + "_" : name;
}

const CONSTRAINT_TEXT: Record<string, string> = {
  num: "a number (int or float)",
  ord: "a comparable type (int, float, str, bool, or tuples/lists of them)",
  sized: "something with a length (str, list, map, set, tuple)",
  hash: "a hashable type (not a list, map, set, or record with var fields)",
};

// ---------------------------------------------------------------------------------------------

export interface CheckResult {
  diags: Diagnostic[];
  exports: ModuleExports;
  imports: { pyModule: string; names?: string[]; alias?: string }[];
  externs: { module: string; alias: string }[];
}

export type ModuleLoader = (modPath: string, fromFile: string, pos: A.Pos) => ModuleExports | { error: string };

export class Checker {
  diags: Diagnostic[] = [];
  types = new Map<string, TypeInfo>();
  typeById = new Map<string, TypeInfo>();
  values = new Map<string, ValueEntry>();
  imports: CheckResult["imports"] = [];
  externs: CheckResult["externs"] = [];
  root!: Scope;
  topCtx!: FnCtx;
  ctxId = 0;
  file: string;
  idPrefix: string;

  constructor(private prog: A.Program, private modName: string, private loader: ModuleLoader, private isEntry: boolean) {
    this.file = prog.file;
    this.idPrefix = isEntry ? "" : modName + "::";
    setHashableNamed((id) => {
      const info = this.typeById.get(id) ?? globalTypeRegistry.get(id);
      if (!info) return true;
      if (info.kind === "record") return !info.fields.some((f) => f.mutable) && !info.extern;
      return true;
    });
  }

  // ---------- diagnostics ----------
  error(pos: A.Pos, code: string, message: string, hint?: string) {
    // avoid duplicate errors at the same spot
    if (this.diags.some((d) => d.line === pos.line && d.col === pos.col && d.message === message)) return;
    this.diags.push({ code, message, file: this.file, line: pos.line, col: pos.col, endCol: pos.end > pos.col ? pos.end : undefined, hint, severity: "error" });
  }
  warn(pos: A.Pos, code: string, message: string, hint?: string) {
    this.diags.push({ code, message, file: this.file, line: pos.line, col: pos.col, endCol: pos.end > pos.col ? pos.end : undefined, hint, severity: "warning" });
  }

  newCtx(opts: Partial<FnCtx> & { name: string }): FnCtx {
    return { id: ++this.ctxId, ret: null, isLambda: false, isTop: false, usesTry: false, tparams: new Map(), loopDepth: 0, locals: [], globals: new Set(), nonlocals: new Set(), ...opts };
  }

  // =============================================================================================
  run(): CheckResult {
    builtinTable();
    this.topCtx = this.newCtx({ name: "<top>", isTop: true });
    this.root = new Scope(this.topCtx);
    const decls = this.prog.decls;

    // 1. imports
    for (const d of decls) if (d.k === "use") this.doUse(d);
    // 2. declare type names
    for (const d of decls) {
      if (d.k === "record" || d.k === "sum" || d.k === "alias") this.declareTypeName(d);
      if (d.k === "extern") for (const it of d.items) if (it.k === "type") this.declareExternType(it);
    }
    // 3. resolve type bodies (aliases first so records can use them)
    for (const d of decls) if (d.k === "alias") this.resolveAlias(d);
    for (const d of decls) if (d.k === "record" || d.k === "sum") this.resolveTypeBody(d);
    for (const d of decls) if (d.k === "extern") this.resolveExtern(d);
    // 4. function signatures
    for (const d of decls) if (d.k === "fn") this.declareFn(d);
    // 5. top-level statements, in order (as one sequence so narrowing carries over)
    this.checkStmtsWithNarrowing(decls.filter((d) => d.k === "stmt").map((d) => (d as Extract<A.Decl, { k: "stmt" }>).stmt), this.root);
    // 6. function bodies and tests
    for (const d of decls) {
      if (d.k === "fn") this.checkFnBody(d, this.root);
      if (d.k === "test") {
        const ctx = this.newCtx({ name: `test "${d.name}"`, ret: UNIT });
        const sc = new Scope(ctx, this.root);
        this.checkBlock(d.body, sc);
        (d as any).globals = ctx.globals;
        this.reportUnused(ctx);
      }
      if (d.k === "record" || d.k === "sum") this.checkTypeDefaults(d);
    }
    // 7. reject unresolvable empty collections at top level etc. (lenient: nothing)
    return { diags: this.diags, exports: this.buildExports(), imports: this.imports, externs: this.externs };
  }

  buildExports(): ModuleExports {
    const values = new Map<string, ValueEntry>();
    const types = new Map<string, TypeInfo>();
    for (const [n, v] of this.values) {
      if (n.startsWith("_") || v.k === "module") continue;
      if ((v as any).imported) continue;
      values.set(n, v);
    }
    for (const [n, v] of this.root.vars) if (!n.startsWith("_")) values.set(n, { k: "global", v });
    for (const [n, t] of this.types) if (!n.startsWith("_") && !(t as any).imported) types.set(n, t);
    return { name: this.modName, pyModule: pyModulePath(this.modName), values, types };
  }

  // ---------- modules ----------
  doUse(d: Extract<A.Decl, { k: "use" }>) {
    const mod = this.loader(d.module, this.file, d);
    if ("error" in mod) { this.error(d, "E190", mod.error); return; }
    if (d.alias) {
      if (this.values.has(d.alias)) this.error(d, "E191", `'${d.alias}' is already defined`);
      this.values.set(d.alias, { k: "module", mod, alias: d.alias });
      this.imports.push({ pyModule: mod.pyModule, alias: d.alias });
      return;
    }
    const wanted = d.names ?? [...new Set([...mod.values.keys(), ...mod.types.keys()])];
    const pyNames: string[] = [];
    for (const n of wanted) {
      const v = mod.values.get(n);
      const t = mod.types.get(n);
      if (!v && !t) {
        const sugg = closest(n, [...mod.values.keys(), ...mod.types.keys()]);
        this.error(d, "E192", `module '${d.module}' has no public item '${n}'`, sugg ? `did you mean '${sugg}'?` : undefined);
        continue;
      }
      if (v) {
        if (v.k === "global" && v.v.mutable) {
          if (d.names) this.error(d, "E193", `'${n}' is a mutable module variable and can't be imported`, "expose it through a function instead");
          continue;
        }
        if (this.values.has(n)) { this.error(d, "E191", `imported name '${n}' conflicts with an existing name`, `import selectively: use ${d.module}: <names>, or use ${d.module} as m`); continue; }
        this.values.set(n, Object.assign({ ...v }, { imported: true }) as ValueEntry);
        if (v.k === "global") pyNames.push(v.v.pyName);
        else if (v.k === "fn") pyNames.push(v.sig.pyName);
        else if (v.k === "record") pyNames.push(v.info.pyName);
        else if (v.k === "variant") pyNames.push(v.info.pyName);
      }
      if (t) {
        if (this.types.has(n)) { this.error(d, "E191", `imported type '${n}' conflicts with an existing type`); continue; }
        this.types.set(n, Object.assign(Object.create(Object.getPrototypeOf(t)), t, { imported: true }));
        this.typeById.set((t as RecordInfo).id ?? n, t);
        if (t.kind !== "alias") {
          pyNames.push(t.pyName);
          // importing a choice type also brings its variants into scope
          if (t.kind === "sum") for (const vi of t.variants) {
            if (!this.values.has(vi.name)) { this.values.set(vi.name, Object.assign({ k: "variant", info: vi } as ValueEntry, { imported: true })); pyNames.push(vi.pyName); }
          }
        }
      }
    }
    this.imports.push({ pyModule: mod.pyModule, names: [...new Set(pyNames)] });
  }

  // ---------- type declarations ----------
  checkNewName(name: string, pos: A.Pos, what: string) {
    if (name.startsWith("_ts_")) this.error(pos, "E122", `names starting with '_ts_' are reserved`);
    if (this.values.has(name) || this.types.has(name)) {
      this.error(pos, "E122", `${what} '${name}' is already defined`, "pick a different name");
      return false;
    }
    return true;
  }

  declareTypeName(d: Extract<A.Decl, { k: "record" | "sum" | "alias" }>) {
    if (this.types.has(d.name)) { this.error(d, "E122", `type '${d.name}' is already defined`); return; }
    const id = this.idPrefix + d.name;
    let info: TypeInfo;
    if (d.k === "record") info = { kind: "record", id, name: d.name, pyName: pyId(d.name), tparams: d.tparams, fields: [], methods: new Map(), decl: d };
    else if (d.k === "sum") info = { kind: "sum", id, name: d.name, pyName: pyId(d.name), tparams: d.tparams, variants: [], methods: new Map(), decl: d };
    else info = { kind: "alias", name: d.name, tparams: d.tparams, type: DYN };
    this.types.set(d.name, info);
    if (info.kind !== "alias") { this.typeById.set(id, info); globalTypeRegistry.set(id, info); }
  }

  declareExternType(it: Extract<A.ExternItem, { k: "type" }>) {
    if (this.types.has(it.name)) { this.error(it.pos, "E122", `type '${it.name}' is already defined`); return; }
    const id = this.idPrefix + it.name;
    const info: RecordInfo = { kind: "record", id, name: it.name, pyName: it.name, tparams: [], fields: [], methods: new Map(), extern: true };
    this.types.set(it.name, info);
    this.typeById.set(id, info);
    globalTypeRegistry.set(id, info);
  }

  tparamMap(tps: A.TParam[]): Map<string, Type> {
    const m = new Map<string, Type>();
    for (const tp of tps) {
      if (tp.constraint && !CONSTRAINT_TEXT[tp.constraint] && tp.constraint !== "eq")
        this.error({ line: 0, col: 0, end: 0 }, "E101", `unknown constraint '${tp.constraint}'`, "use num, ord, eq, or hash");
      m.set(tp.name, { k: "param", name: tp.name, constraint: tp.constraint });
    }
    return m;
  }

  resolveAlias(d: Extract<A.Decl, { k: "alias" }>) {
    const info = this.types.get(d.name) as AliasInfo;
    info.type = this.toType(d.type, this.tparamMap(d.tparams));
  }

  resolveTypeBody(d: Extract<A.Decl, { k: "record" | "sum" }>) {
    const info = this.types.get(d.name);
    if (!info || info.kind === "alias") return;
    const tm = this.tparamMap(d.tparams);
    const fieldsOf = (fs: A.FieldDecl[], allowVar: boolean): FieldInfo[] => {
      const seen = new Set<string>();
      let sawDefault = false;
      return fs.map((f) => {
        if (seen.has(f.name)) this.error(f.pos, "E122", `duplicate field '${f.name}'`);
        seen.add(f.name);
        if (f.mutable && !allowVar) this.error(f.pos, "E180", "variant fields can't be 'var'", "use a record type for mutable state");
        if (f.default) sawDefault = true;
        else if (sawDefault) this.error(f.pos, "E180", `field '${f.name}' without a default must come before fields with defaults`);
        return { name: f.name, type: this.toType(f.type, tm), mutable: f.mutable, hasDefault: !!f.default };
      });
    };
    if (d.k === "record" && info.kind === "record") {
      info.fields = fieldsOf(d.fields, true);
      if (this.values.has(d.name)) this.error(d, "E122", `'${d.name}' is already defined`);
      this.values.set(d.name, { k: "record", info });
    } else if (d.k === "sum" && info.kind === "sum") {
      for (const v of d.variants) {
        if (v.name === d.name) this.error(v.pos, "E122", `variant '${v.name}' can't have the same name as its type`, `rename the type, e.g. '${d.name}Kind'`);
        const vi: VariantInfo = { name: v.name, pyName: pyId(v.name), sum: info, fields: fieldsOf(v.fields, false), hasParens: v.hasParens };
        if (this.values.has(v.name) || this.types.has(v.name)) { this.error(v.pos, "E122", `'${v.name}' is already defined`, "variant names must be unique in a module"); continue; }
        info.variants.push(vi);
        this.values.set(v.name, { k: "variant", info: vi });
      }
    }
  }

  checkTypeDefaults(d: Extract<A.Decl, { k: "record" | "sum" }>) {
    const info = this.types.get(d.name);
    if (!info || info.kind === "alias") return;
    const fields = d.k === "record" ? d.fields : d.variants.flatMap((v) => v.fields);
    const infos = info.kind === "record" ? info.fields : info.variants.flatMap((v) => v.fields);
    fields.forEach((f, i) => {
      if (!f.default || !infos[i]) return;
      const t = this.expr(f.default, this.root, infos[i].type);
      this.expectType(t, infos[i].type, f.default, `default for field '${f.name}'`);
    });
  }

  resolveExtern(d: Extract<A.Decl, { k: "extern" }>) {
    const alias = "_x_" + d.module.replace(/\./g, "_");
    if (!this.externs.some((e) => e.alias === alias)) this.externs.push({ module: d.module, alias });
    for (const it of d.items) {
      if (it.k === "type") {
        const info = this.types.get(it.name) as RecordInfo;
        if (info?.kind === "record") info.fields = it.fields.map((f) => ({ name: f.name, type: this.toType(f.type, new Map()), mutable: f.mutable, hasDefault: false }));
      } else if (it.k === "const") {
        if (!this.checkNewName(it.name, it.pos, "name")) continue;
        this.values.set(it.name, { k: "const", type: this.toType(it.type, new Map()), py: `${alias}.${it.name}` });
      } else {
        const tm = this.tparamMap(it.tparams);
        const sig: FnSig = {
          name: it.name, pyName: `${alias}.${it.pyName}`, tparams: it.tparams,
          params: it.params.map((p) => ({ name: p.name, type: this.toType(p.type!, tm), hasDefault: !!p.default, mutable: !!p.mutable, default: p.default })),
          ret: it.ret ? this.toType(it.ret, tm) : UNIT,
        };
        if (it.owner) {
          const owner = this.types.get(it.owner);
          if (!owner || owner.kind !== "record" || !owner.extern) { this.error(it.pos, "E101", `'${it.owner}' is not an extern type declared in this block`); continue; }
          sig.pyName = it.pyName;
          owner.methods.set(it.name, sig);
        } else {
          if (!this.checkNewName(it.name, it.pos, "function")) continue;
          this.values.set(it.name, { k: "fn", sig });
        }
      }
    }
  }

  // ---------- type expressions ----------
  toType(te: A.TypeExpr, tm: Map<string, Type>): Type {
    switch (te.k) {
      case "tlist": return list(this.toType(te.el, tm));
      case "tmap": {
        const key = this.toType(te.key, tm);
        if (!isHashable(key)) this.error(te.key, "E180", `${show(key)} can't be a map key`, "map keys must be hashable: int, str, bool, float, tuples, or records without var fields");
        return map(key, this.toType(te.val, tm));
      }
      case "ttuple": return tuple(te.els.map((e) => this.toType(e, tm)));
      case "topt": {
        const inner = this.toType(te.inner, tm);
        if (prune(inner).k === "opt") this.error(te, "E180", "nested optionals (T??) are not supported", "use a choice type to tell the cases apart");
        return opt(inner);
      }
      case "tres": return res(this.toType(te.ok, tm), this.toType(te.err, tm));
      case "tfn": return fnType(te.params.map((p) => this.toType(p, tm)), this.toType(te.ret, tm));
      case "tname": {
        const prim: Record<string, Type> = { int: INT, float: FLOAT, str: STR, bool: BOOL, dyn: DYN, never: NEVER };
        if (prim[te.name]) { if (te.args.length) this.error(te, "E101", `'${te.name}' takes no type arguments`); return prim[te.name]; }
        if (tm.has(te.name)) return tm.get(te.name)!;
        if (te.name === "set") {
          if (te.args.length !== 1) { this.error(te, "E101", "set needs one type argument", "set[int]"); return DYN; }
          const el = this.toType(te.args[0], tm);
          if (!isHashable(el)) this.error(te, "E180", `${show(el)} can't be a set element`, "set elements must be hashable");
          return { k: "set", el };
        }
        let info: TypeInfo | undefined;
        if (te.name.includes(".")) {
          const [modAlias, tn] = te.name.split(".");
          const m = this.values.get(modAlias);
          if (m?.k === "module") info = m.mod.types.get(tn);
        } else info = this.types.get(te.name);
        if (!info) {
          const hints: Record<string, string> = {
            list: "list types are written [T], e.g. [int]", List: "list types are written [T], e.g. [int]",
            dict: "map types are written {K: V}, e.g. {str: int}", Dict: "map types are written {K: V}", map: "map types are written {K: V}",
            Option: "optional types are written T?, e.g. int?", Optional: "optional types are written T?, e.g. int?",
            Result: "result types are written T!E, e.g. int!str", string: "the string type is 'str'", String: "the string type is 'str'",
            number: "use int or float", boolean: "the boolean type is 'bool'", void: "functions without '->' return nothing", None: "use 'T?' for optional values",
            any: "the dynamic type is 'dyn'", Any: "the dynamic type is 'dyn'", double: "use float", char: "characters are just str",
          };
          const sugg = closest(te.name, [...this.types.keys(), "int", "float", "str", "bool", "dyn", ...tm.keys()]);
          this.error(te, "E101", `unknown type '${te.name}'`, hints[te.name] ?? (sugg ? `did you mean '${sugg}'?` : undefined));
          return DYN;
        }
        if (info.kind === "alias") {
          if (te.args.length !== info.tparams.length) this.error(te, "E101", `type '${te.name}' takes ${info.tparams.length} type argument(s)`);
          const m = new Map(info.tparams.map((tp, i) => [tp.name, te.args[i] ? this.toType(te.args[i], tm) : DYN]));
          return subst(info.type, m);
        }
        if (te.args.length !== info.tparams.length) {
          this.error(te, "E101", `type '${info.name}' takes ${info.tparams.length} type argument(s), got ${te.args.length}`,
            info.tparams.length ? `${info.name}[${info.tparams.map((t) => t.name).join(", ")}]` : undefined);
        }
        return { k: "named", name: info.id, args: info.tparams.map((_, i) => (te.args[i] ? this.toType(te.args[i], tm) : DYN)) };
      }
    }
  }

  typeInfoOf(t: Type): RecordInfo | SumInfo | undefined {
    t = prune(t);
    if (t.k !== "named") return undefined;
    const info = this.typeById.get(t.name) ?? globalTypeRegistry.get(t.name);
    return info && info.kind !== "alias" ? info : undefined;
  }

  /** Field types of a record/variant, specialized to the given named type's arguments. */
  specialize(info: RecordInfo | SumInfo, t: Type, ty: Type): Type {
    const nt = prune(t);
    if (nt.k !== "named" || info.tparams.length === 0) return ty;
    return subst(ty, new Map(info.tparams.map((tp, i) => [tp.name, nt.args[i] ?? DYN])));
  }

  // ---------- functions ----------
  declareFn(d: A.FnDecl) {
    const tm = this.tparamMap(d.tparams);
    let ownerInfo: RecordInfo | SumInfo | undefined;
    if (d.owner) {
      const o = this.types.get(d.owner);
      if (!o || o.kind === "alias") { this.error(d, "E101", `unknown type '${d.owner}' for method '${d.name}'`); return; }
      if (o.kind === "record" && o.extern) { this.error(d, "E101", `can't add methods to extern type '${d.owner}'`); return; }
      ownerInfo = o;
      for (const tp of o.tparams) tm.set(tp.name, { k: "param", name: tp.name, constraint: tp.constraint });
    }
    const seen = new Set<string>();
    let sawDefault = false;
    const params: SigParam[] = d.params.map((p) => {
      if (seen.has(p.name)) this.error(p.pos, "E122", `duplicate parameter '${p.name}'`);
      seen.add(p.name);
      if (p.default) sawDefault = true;
      else if (sawDefault) this.error(p.pos, "E180", `parameter '${p.name}' without a default must come before parameters with defaults`);
      return { name: p.name, type: this.toType(p.type!, tm), hasDefault: !!p.default, mutable: !!p.mutable, default: p.default };
    });
    const ret = d.ret ? this.toType(d.ret, tm) : fresh();
    const infer = d.ret ? undefined : { state: "pending" as const, decl: d, scope: () => this.root };
    if (ownerInfo) {
      const pyName = `_tsm_${ownerInfo.pyName}_${d.name}`;
      const sig: FnSig = { name: d.name, pyName, tparams: [...ownerInfo.tparams, ...d.tparams], params, ret, infer };
      if (ownerInfo.methods.has(d.name)) this.error(d, "E122", `method '${d.owner}.${d.name}' is already defined`);
      if (ownerInfo.kind === "record" && ownerInfo.fields.some((f) => f.name === d.name)) this.error(d, "E122", `'${d.owner}' already has a field named '${d.name}'`);
      ownerInfo.methods.set(d.name, sig);
      (d as any).sig = sig;
    } else {
      if (!this.checkNewName(d.name, d, "function")) return;
      const sig: FnSig = { name: d.name, pyName: pyId(d.name), tparams: d.tparams, params, ret, infer };
      this.values.set(d.name, { k: "fn", sig });
      (d as any).sig = sig;
    }
  }

  /** Make sure a function's inferred return type is known before it's used. */
  ensureInferred(sig: FnSig, at?: A.Pos) {
    const inf = sig.infer;
    if (!inf || inf.state === "done") return;
    if (inf.state === "checking") {
      if (!inf.reported) {
        inf.reported = true;
        this.error(at ?? inf.decl, "E150", `'${sig.name}' is used inside its own body, so it needs an explicit return type`,
          `declare it: fn ${inf.decl.owner ? inf.decl.owner + "." : ""}${sig.name}(...) -> <type>:`);
      }
      unify(sig.ret, DYN);
      return;
    }
    this.checkFnBody(inf.decl, inf.scope());
  }

  checkFnBody(d: A.FnDecl, outer: Scope) {
    const sig: FnSig | undefined = (d as any).sig;
    if (!sig) return;
    if (sig.infer) {
      if (sig.infer.state !== "pending") return;
      sig.infer.state = "checking";
    }
    const tm = new Map<string, Type>();
    for (const tp of sig.tparams) tm.set(tp.name, { k: "param", name: tp.name, constraint: tp.constraint });
    const ctx = this.newCtx({ name: d.owner ? `${d.owner}.${d.name}` : d.name, ret: sig.ret, decl: d, tparams: tm });
    if (sig.infer) ctx.inferred = { types: [], opt: false };
    const sc = new Scope(ctx, outer);
    if (d.owner) {
      const info = this.types.get(d.owner) as RecordInfo | SumInfo;
      const selfT: Type = { k: "named", name: info.id, args: info.tparams.map((tp) => tm.get(tp.name)!) };
      sc.vars.set("self", { name: "self", pyName: "self", type: selfT, mutable: false, ctx, used: true, pos: d, isGlobal: false, inLoop: false, isParam: true });
    }
    for (const p of sig.params) {
      const decl = d.params.find((x) => x.name === p.name)!;
      sc.vars.set(p.name, { name: p.name, pyName: pyId(p.name), type: p.type, mutable: p.mutable, ctx, used: true, pos: decl.pos, isGlobal: false, inLoop: false, isParam: true });
      if (p.default) {
        const t = this.expr(p.default, outer, p.type);
        this.expectType(t, p.type, p.default, `default value of '${p.name}'`);
      }
    }
    if (sig.infer) {
      const inf = ctx.inferred!;
      if ("stmts" in d.body) {
        const t = this.blockValue(d.body, sc, undefined);
        const last = d.body.stmts[d.body.stmts.length - 1];
        const valued = inf.types.some((x) => prune(x.t).k !== "unit" && prune(x.t).k !== "never");
        if (prune(t).k === "unit" && valued && last && !this.stmtTerminates(last)) {
          this.error(last, "E150", `'${ctx.name}' returns a value on some paths but can reach the end without one`,
            "end the body with an expression, or add a 'return' statement");
        }
        if (last?.k === "expr" || !valued) inf.types.push({ t, at: last ?? d });
      } else {
        inf.types.push({ t: this.expr(d.body, sc), at: d.body });
      }
      let r: Type = NEVER;
      for (const x of inf.types) {
        const px = prune(x.t);
        if (px.k === "unit" && prune(r).k !== "never" && prune(r).k !== "unit") {
          this.error(x.at, "E150", `'${ctx.name}' returns a value on some paths but not here`, "return a value on every path, or declare the return type");
          continue;
        }
        r = this.join(r, x.t, x.at);
      }
      if (prune(r).k === "never") r = inf.types.length ? NEVER : UNIT;
      if (inf.opt && prune(r).k !== "opt") r = prune(r).k === "unit" ? opt(fresh()) : opt(r);
      if (inf.err && prune(r).k !== "res") {
        this.error(d, "E160", `'${ctx.name}' uses '?' on a result, so it must return a result`, `end it with ok(...) or declare: -> <type>!${show(inf.err)}`);
      }
      unify(sig.ret, r);
      sig.infer!.state = "done";
    } else if ("stmts" in d.body) {
      if (prune(sig.ret).k === "unit") this.checkBlock(d.body, sc);
      else {
        const pr = prune(sig.ret);
        const unitResult = pr.k === "res" && prune(pr.ok).k === "unit";
        const t = this.blockValue(d.body, sc, sig.ret);
        const last = d.body.stmts[d.body.stmts.length - 1];
        if (unitResult && (prune(t).k === "unit" || !last)) {
          // a function returning ()!E that falls off the end succeeds: implicit ok(())
          d.implicitOk = true;
        } else if (prune(t).k === "unit" && last && !this.stmtTerminates(last)) {
          this.error(last, "E150", `function '${ctx.name}' must return ${show(sig.ret)}, but its body can end without a value`,
            "end the body with an expression, or add a 'return' statement");
        } else if (last?.k === "expr") {
          this.expectType(t, sig.ret, last.expr, `return value of '${ctx.name}'`);
        }
      }
    } else if (!sig.infer) {
      const t = this.expr(d.body, sc, sig.ret);
      const pr = prune(sig.ret);
      if (pr.k === "res" && prune(pr.ok).k === "unit" && prune(t).k === "unit") d.implicitOk = true;
      else if (pr.k !== "unit") this.expectType(t, sig.ret, d.body, `return value of '${ctx.name}'`);
    }
    d.usesTry = ctx.usesTry;
    d.globals = ctx.globals;
    d.nonlocals = ctx.nonlocals;
    this.reportUnused(ctx);
  }

  reportUnused(ctx: FnCtx) {
    for (const v of ctx.locals) {
      if (!v.used && !v.name.startsWith("_") && !v.isParam) {
        this.warn(v.pos, "W200", `variable '${v.name}' is never used`, `remove it, or name it '_${v.name}' if that's intentional`);
      }
    }
  }

  // ---------- variables ----------
  /** Declare a new local or global variable. */
  declare(scope: Scope, name: string, type: Type, mutable: boolean, pos: A.Pos, allowShadow = false): VarInfo | undefined {
    if (name === "_") return undefined;
    if (name.startsWith("_ts_")) this.error(pos, "E122", "names starting with '_ts_' are reserved");
    while (scope.narrow && scope.parent && scope.parent.ctx === scope.ctx) scope = scope.parent;
    // Python has function-level scope, so a name can be declared only once per function
    for (let s: Scope | undefined = scope; s && s.ctx === scope.ctx && !allowShadow; s = s.parent) {
      const existing = s.vars.get(name);
      if (existing) {
        this.error(pos, "E122", `'${name}' is already defined in this function (line ${existing.pos.line})`,
          existing.mutable ? `to change it, assign without redeclaring: ${name} = ...` : `use a different name, or declare the first one with 'var ${name} = ...' and reassign it`);
        return undefined;
      }
    }
    if (scope.ctx.isTop && (this.values.has(name))) {
      this.error(pos, "E122", `'${name}' is already defined at the top level`);
    }
    const v: VarInfo = {
      name, pyName: pyId(name), type, mutable, ctx: scope.ctx, used: false, pos, isGlobal: scope.ctx.isTop,
      inLoop: scope.inLoop(), isParam: false,
    };
    scope.vars.set(name, v);
    if (!scope.ctx.isTop) scope.ctx.locals.push(v);
    return v;
  }

  markUsed(v: VarInfo) { v.used = true; if (v.origin) v.origin.used = true; }

  // ---------- statements ----------
  checkBlock(b: A.Block, scope: Scope): boolean {
    return this.checkStmtsWithNarrowing(b.stmts, scope.child());
  }

  /** Checks statements; returns true if the sequence always terminates (return/break/panic...). */
  checkStmtsWithNarrowing(stmts: A.Stmt[], scope: Scope): boolean {
    let cur = scope;
    let terminated = false;
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      if (terminated) { this.warn(s, "W201", "unreachable code"); }
      this.stmt(s, cur);
      if (this.stmtTerminates(s)) terminated = true;
      // `if x == none: return` narrows x for the rest of the block
      if (s.k === "expr" && s.expr.k === "if" && !s.expr.else && s.expr.branches.length === 1 && this.blockTerminates(s.expr.branches[0].body)) {
        const n = this.narrowings(s.expr.branches[0].cond, cur);
        if (n.f.length) { cur = cur.child(); cur.narrow = true; for (const [name, v] of n.f) cur.vars.set(name, v); }
      }
    }
    return terminated;
  }

  stmtTerminates(s: A.Stmt): boolean {
    switch (s.k) {
      case "return": case "break": case "continue": return true;
      case "expr": {
        const t = s.expr.ty ? prune(s.expr.ty) : undefined;
        if (t?.k === "never") return true;
        if (s.expr.k === "if") return !!s.expr.else && s.expr.branches.every((b) => this.blockTerminates(b.body)) && this.blockTerminates(s.expr.else);
        if (s.expr.k === "match") return s.expr.arms.every((a) => this.blockTerminates(a.body));
        return false;
      }
      case "while": return s.cond.k === "bool" && s.cond.value && !this.containsBreak(s.body);
      default: return false;
    }
  }
  blockTerminates(b: A.Block): boolean { return b.stmts.some((s) => this.stmtTerminates(s)); }
  containsBreak(b: A.Block): boolean {
    const walk = (ss: A.Stmt[]): boolean => ss.some((s) => {
      if (s.k === "break") return true;
      if (s.k === "expr" && s.expr.k === "if") return s.expr.branches.some((br) => walk(br.body.stmts)) || (!!s.expr.else && walk(s.expr.else.stmts));
      if (s.k === "expr" && s.expr.k === "match") return s.expr.arms.some((a) => walk(a.body.stmts));
      return false; // nested loops own their breaks
    });
    return walk(b.stmts);
  }

  /** The value of a block: its last statement, if that's an expression. */
  blockValue(b: A.Block, scope: Scope, expected?: Type): Type {
    const sc = scope.child();
    const stmts = b.stmts;
    if (stmts.length === 0) return UNIT;
    const term = this.checkStmtsWithNarrowingUntilLast(stmts, sc);
    const last = stmts[stmts.length - 1];
    if (last.k === "expr") {
      const t = this.expr(last.expr, term.scope, expected, true);
      last.expr.ty = t;
      return t;
    }
    this.stmt(last, term.scope);
    return this.stmtTerminates(last) || term.terminated ? NEVER : UNIT;
  }

  checkStmtsWithNarrowingUntilLast(stmts: A.Stmt[], scope: Scope): { scope: Scope; terminated: boolean } {
    let cur = scope;
    let terminated = false;
    for (let i = 0; i < stmts.length - 1; i++) {
      const s = stmts[i];
      this.stmt(s, cur);
      if (this.stmtTerminates(s)) terminated = true;
      if (s.k === "expr" && s.expr.k === "if" && !s.expr.else && s.expr.branches.length === 1 && this.blockTerminates(s.expr.branches[0].body)) {
        const n = this.narrowings(s.expr.branches[0].cond, cur);
        if (n.f.length) { cur = cur.child(); cur.narrow = true; for (const [name, v] of n.f) cur.vars.set(name, v); }
      }
    }
    return { scope: cur, terminated };
  }

  stmt(s: A.Stmt, scope: Scope) {
    switch (s.k) {
      case "expr": {
        const t = this.expr(s.expr, scope, undefined, false);
        this.checkDiscard(s.expr, t, scope);
        return;
      }
      case "let": return this.letStmt(s, scope);
      case "assign": return this.assignStmt(s, scope);
      case "while": {
        this.cond(s.cond, scope, "while");
        const n = this.narrowings(s.cond, scope);
        const body = scope.child(true);
        for (const [name, v] of n.t) body.vars.set(name, v);
        scope.ctx.loopDepth++;
        this.checkStmtsWithNarrowing(s.body.stmts, body);
        scope.ctx.loopDepth--;
        return;
      }
      case "for": {
        const iterT = this.expr(s.iter, scope);
        const elT = this.elementType(iterT, s.iter);
        const body = scope.child(true);
        this.bindTarget(s.target, elT, body, false);
        scope.ctx.loopDepth++;
        this.checkStmtsWithNarrowing(s.body.stmts, body);
        scope.ctx.loopDepth--;
        return;
      }
      case "return": {
        const ctx = scope.ctx;
        if (ctx.isTop) { this.error(s, "E150", "'return' outside of a function", "use exit(code) to stop the program"); return; }
        if (ctx.isLambda) { this.error(s, "E150", "'return' is not allowed in a lambda; the body expression is the result"); return; }
        if (ctx.inferred) {
          ctx.inferred.types.push({ t: s.value ? this.expr(s.value, scope, undefined, true) : UNIT, at: s.value ?? s });
          return;
        }
        const ret = ctx.ret ?? UNIT;
        if (!s.value) {
          if (prune(ret).k !== "unit" && prune(ret).k !== "opt") this.error(s, "E150", `'${ctx.name}' must return ${show(ret)}`, "return a value: return <expr>");
          if (prune(ret).k === "opt") this.error(s, "E150", `'${ctx.name}' returns ${show(ret)}; write 'return none' explicitly`);
          return;
        }
        if (prune(ret).k === "unit") {
          const t = this.expr(s.value, scope);
          if (prune(t).k !== "unit" && prune(t).k !== "never") this.error(s.value, "E150", `'${ctx.name}' has no return type, but returns a value`, `declare it: fn ${ctx.name}(...) -> ${show(t)}`);
          return;
        }
        const t = this.expr(s.value, scope, ret, true);
        this.expectType(t, ret, s.value, `return value of '${ctx.name}'`);
        return;
      }
      case "break": case "continue":
        if (scope.ctx.loopDepth === 0) this.error(s, "E150", `'${s.k}' outside of a loop`);
        return;
      case "assert": {
        this.cond(s.cond, scope, "assert");
        if (s.msg) this.expr(s.msg, scope);
        return;
      }
      case "pass": return;
      case "fndecl": {
        const d = s.decl;
        if (d.owner) { this.error(d, "E180", "methods must be declared at the top level"); return; }
        const tm = this.tparamMapFromCtx(scope, d.tparams);
        const params: SigParam[] = d.params.map((p) => ({ name: p.name, type: this.toType(p.type!, tm), hasDefault: !!p.default, mutable: !!p.mutable, default: p.default }));
        const ret = d.ret ? this.toType(d.ret, tm) : fresh();
        const sig: FnSig = { name: d.name, pyName: pyId(d.name), tparams: d.tparams, params, ret,
          infer: d.ret ? undefined : { state: "pending", decl: d, scope: () => scope } };
        (d as any).sig = sig;
        // declare as an immutable local holding a function; recursion works because it's declared first
        const v = this.declare(scope, d.name, fnType(params.map((p) => p.type), ret, params.filter((p) => !p.hasDefault).length), false, d);
        if (v) { v.used = true; (v as any).sig = sig; }
        this.checkFnBody(d, scope);
        return;
      }
    }
  }

  tparamMapFromCtx(scope: Scope, tps: A.TParam[]): Map<string, Type> {
    const m = new Map(scope.ctx.tparams);
    for (const [k, v] of this.tparamMap(tps)) m.set(k, v);
    return m;
  }

  /** Discarding a value that matters is almost always an AI bug. */
  checkDiscard(e: A.Expr, t: Type, scope: Scope) {
    const pt = prune(t);
    if (e.k === "call" && e.resolved?.kind === "builtin") {
      const b = BUILTINS[e.resolved.builtin];
      if (b.pure && pt.k !== "unit") {
        const name = b.sig.split(/[[(]/)[0];
        const target = e.callee.k === "member" ? exprText(e.callee.obj) : undefined;
        const tv = target && /^[a-z_][a-z0-9_]*$/i.test(target) ? scope.lookup(target) : undefined;
        this.error(e, "E141", `the result of '${name}' is discarded; ${name}() returns a new value and doesn't change anything`,
          tv?.mutable ? `assign it: ${target} = ${exprText(e)}` : `store it in a new variable: new_${target && /^[a-z_]\w*$/i.test(target) ? target : "value"} = ${exprText(e)}`);
        return;
      }
    }
    if (pt.k === "res" && e.k !== "if" && e.k !== "match") {
      this.error(e, "E141", "this Result is ignored, so a failure would go unnoticed",
        "handle it: add '?' to propagate the error, '!' to stop on error, or match on ok/err (write '_ = ...' to ignore on purpose)");
      return;
    }
    if (e.k === "binary" && (e.op === "==" || COMPARE_OPS.has(e.op))) {
      this.error(e, "E141", "this comparison's result is unused", e.op === "==" ? "did you mean '=' (assignment)?" : undefined);
    }
  }

  letStmt(s: Extract<A.Stmt, { k: "let" }>, scope: Scope) {
    const declared = s.type ? this.toType(s.type, scope.ctx.tparams) : undefined;
    const t = this.expr(s.value, scope, declared, true);
    if (declared) this.expectType(t, declared, s.value, "value");
    const vt = declared ?? t;
    if (prune(vt).k === "unit" || prune(vt).k === "never") this.error(s.value, "E110", `can't store the result of an expression that has no value`);
    this.bindTarget(s.target, vt, scope, s.mutable, s.value);
  }

  /** Bind a declaration target (name or tuple of names) to a type. */
  bindTarget(p: A.Pattern, t: Type, scope: Scope, mutable: boolean, valueExpr?: A.Expr, allowShadow = false) {
    if (p.k === "pwild") return;
    if (p.k === "pbind") {
      this.declare(scope, p.name, t, mutable, p, allowShadow);
      return;
    }
    if (p.k === "ptuple") {
      const pt = prune(t);
      if (pt.k === "tuple") {
        if (pt.els.length !== p.els.length) this.error(p, "E110", `can't unpack a ${pt.els.length}-tuple into ${p.els.length} names`);
        p.els.forEach((el, i) => this.bindTarget(el, pt.els[i] ?? DYN, scope, mutable, undefined, allowShadow));
      } else if (pt.k === "list") {
        p.els.forEach((el) => this.bindTarget(el, pt.el, scope, mutable, undefined, allowShadow));
      } else if (pt.k === "dyn" || pt.k === "var") {
        p.els.forEach((el) => this.bindTarget(el, DYN, scope, mutable, undefined, allowShadow));
      } else {
        this.error(valueExpr ?? p, "E110", `can't unpack ${show(t)} into ${p.els.length} names`, "only tuples and lists can be unpacked");
      }
      return;
    }
    this.error(p, "E002", "invalid assignment target");
  }

  assignStmt(s: Extract<A.Stmt, { k: "assign" }>, scope: Scope) {
    const tgt = s.target;
    // `x = value` declares x unless it already exists as a mutable variable
    if (s.op === "=" && (tgt.k === "name" || (tgt.k === "tuple" && tgt.items.every((i) => i.k === "name")))) {
      const names = tgt.k === "name" ? [tgt] : (tgt.items as Extract<A.Expr, { k: "name" }>[]);
      // an immutable variable from an outer function (or the top level) is shadowed, not reassigned
      const existing = (n: string) => { const v = scope.lookup(n); return v && (v.ctx === scope.ctx || v.mutable) ? v : undefined; };
      const anyExisting = names.some((n) => n.name !== "_" && existing(n.name));
      if (!anyExisting || tgt.k === "name") {
        if (tgt.k === "name") {
          if (tgt.name === "_") { this.expr(s.value, scope); return; }
          const v = existing(tgt.name);
          if (!v) {
            const t = this.expr(s.value, scope, undefined, true);
            if (prune(t).k === "unit") this.error(s.value, "E110", `'${exprText(s.value)}' doesn't return a value, so there's nothing to store in '${tgt.name}'`);
            const nv = this.declare(scope, tgt.name, t, false, tgt);
            const kind = prune(t).k;
            if (nv && (s.value.k === "name" || s.value.k === "member") && (kind === "list" || kind === "map" || kind === "set")) nv.aliasOf = exprText(s.value);
            tgt.ref = { kind: "var", pyName: pyId(tgt.name) };
            return;
          }
          return this.reassignName(tgt, v, s.value, scope, s);
        }
        // tuple of all-new names
        const t = this.expr(s.value, scope, undefined, true);
        const pat: A.Pattern = { k: "ptuple", els: names.map((n) => (n.name === "_" ? { k: "pwild", ...pos(n) } : { k: "pbind", name: n.name, ...pos(n) })), ...pos(tgt) };
        this.bindTarget(pat, t, scope, false, s.value);
        for (const n of names) n.ref = { kind: "var", pyName: pyId(n.name) };
        return;
      }
      // tuple assignment with some existing names: each existing must be mutable, new ones are declared
      const t = this.expr(s.value, scope, undefined, true);
      const pt = prune(t);
      names.forEach((n, i) => {
        const elT = pt.k === "tuple" ? pt.els[i] ?? DYN : pt.k === "list" ? pt.el : DYN;
        if (n.name === "_") return;
        const v = existing(n.name);
        if (!v) { this.declare(scope, n.name, elT, false, n); }
        else this.checkReassign(n, v, elT, scope, n);
        n.ref = { kind: "var", pyName: pyId(n.name) };
      });
      return;
    }
    // compound assignment or member/index targets
    if (tgt.k === "name") {
      const v = scope.lookup(tgt.name);
      if (!v) {
        const sugg = closest(tgt.name, this.visibleNames(scope));
        this.error(tgt, "E100", `unknown variable '${tgt.name}'`, sugg ? `did you mean '${sugg}'?` : `declare it first: var ${tgt.name} = ...`);
        this.expr(s.value, scope);
        return;
      }
      tgt.ref = { kind: "var", pyName: v.pyName };
      const op = s.op.slice(0, -1);
      const rt = this.expr(s.value, scope, v.type);
      const result = this.binaryType(op, v.type, rt, s);
      this.checkReassign(tgt, v, result, scope, s.value);
      return;
    }
    if (tgt.k === "member" || tgt.k === "index") {
      const tt = this.expr(tgt, scope);
      this.requireMutablePlace(tgt, scope, "assign to");
      if (tgt.k === "index") {
        const ot = prune(tgt.obj.ty ?? DYN);
        if (ot.k === "str") this.error(tgt, "E121", "strings are immutable; you can't assign to a character", "build a new string instead, e.g. s[:i] + c + s[i+1:]");
        if (ot.k === "tuple") this.error(tgt, "E121", "tuples are immutable");
      }
      if (s.op === "=") {
        const vt = this.expr(s.value, scope, tt, true);
        this.expectType(vt, tt, s.value, "assigned value");
      } else {
        const vt = this.expr(s.value, scope, tt);
        const result = this.binaryType(s.op.slice(0, -1), tt, vt, s);
        this.expectType(result, tt, s, "result");
      }
      return;
    }
    this.error(tgt, "E002", "can't assign to this expression", "assign to a variable, a field (obj.x), or an element (xs[i])");
  }

  reassignName(tgt: Extract<A.Expr, { k: "name" }>, v: VarInfo, value: A.Expr, scope: Scope, s: A.Pos) {
    const t = this.expr(value, scope, v.origin ? v.origin.type : v.type, true);
    this.checkReassign(tgt, v, t, scope, value);
    tgt.ref = { kind: "var", pyName: v.pyName };
  }

  checkReassign(tgt: A.Pos & { name?: string }, v: VarInfo, t: Type, scope: Scope, valuePos: A.Pos) {
    const name = v.name;
    if (!v.mutable) {
      const where = v.isParam ? `parameter '${name}'` : `'${name}'`;
      const sameFn = v.ctx === scope.ctx;
      this.error(tgt, "E120", `can't reassign ${where}: it is immutable`,
        v.isParam ? `copy it into a mutable local: var ${name}2 = ${name}  (or mark the parameter 'var ${name}: ...')`
          : sameFn ? `declare it with 'var ${name} = ...' where it is first defined (line ${v.pos.line})`
          : `declare it with 'var' at line ${v.pos.line}`);
      return;
    }
    if (v.origin) {
      // assigning a narrowed variable: check against its declared type, and drop the narrowing
      this.expectType(t, v.origin.type, valuePos, `new value of '${name}'`);
      v.type = v.origin.type;
    } else this.expectType(t, v.type, valuePos, `new value of '${name}'`);
    // assigning an outer function's variable needs nonlocal/global in Python
    if (v.ctx !== scope.ctx) {
      if (scope.ctx.isLambda) { this.error(tgt, "E180", "lambdas can't assign variables"); return; }
      if (v.isGlobal) scope.ctx.globals.add(v.pyName);
      else scope.ctx.nonlocals.add(v.pyName);
    }
  }

  /** Mutation (push, x.f = ..., xs[i] = ...) requires a `var` binding or field. */
  requireMutablePlace(e: A.Expr, scope: Scope, verb: string, culprit?: A.Expr): boolean {
    switch (e.k) {
      case "name": {
        const v = scope.lookup(e.name);
        if (!v) return true;
        if (v.mutable) {
          if (v.ctx !== scope.ctx && scope.ctx.isLambda) return true;
          return true;
        }
        if (v.name === "self") return true;
        if (v.aliasOf) {
          this.error(culprit ?? e, "E121", `can't ${verb} '${e.name}': it is immutable, and it is the same object as '${v.aliasOf}'`,
            `to change a separate copy: var ${e.name} = ${v.aliasOf}.copy()  (line ${v.pos.line})`);
          return false;
        }
        this.error(culprit ?? e, "E121", `can't ${verb} '${e.name}': it is immutable`,
          v.isParam ? `mark the parameter as mutable: var ${e.name}: ${show(v.type)}` : `declare it with 'var ${e.name} = ...' (line ${v.pos.line})`);
        return false;
      }
      case "member": {
        const ot = prune(e.obj.ty ?? DYN);
        if (ot.k === "dyn") return true;
        const info = this.typeInfoOf(ot);
        if (info?.kind === "record") {
          const f = info.fields.find((x) => x.name === e.name);
          if (f && !f.mutable && !info.extern) {
            this.error(culprit ?? e, "E121", `can't ${verb} field '${e.name}': it is immutable`,
              `declare the field as 'var ${e.name}: ${show(f.type)}' in type ${info.name}, or create a new value with ${exprText(e.obj)}.with(${e.name}=...)`);
            return false;
          }
          return true;
        }
        return true;
      }
      case "index": return this.requireMutablePlace(e.obj, scope, verb, culprit ?? e);
      default: return true; // fresh values (calls, literals) can be mutated freely
    }
  }

  cond(e: A.Expr, scope: Scope, what: string) {
    const t = this.expr(e, scope, BOOL);
    this.requireBool(t, e, what);
  }

  requireBool(t: Type, e: A.Expr, what: string) {
    const pt = prune(t);
    if (pt.k === "bool" || pt.k === "dyn" || pt.k === "never") return;
    if (pt.k === "var") { unify(pt, BOOL); return; }
    let hint: string | undefined;
    if (pt.k === "opt") hint = `compare explicitly: ${exprText(e)} != none`;
    else if (pt.k === "list" || pt.k === "map" || pt.k === "set" || pt.k === "str") hint = `Tersa has no truthiness; write: len(${exprText(e)}) > 0  (or ${exprText(e)}.is_empty())`;
    else if (pt.k === "int" || pt.k === "float") hint = `write the comparison explicitly, e.g. ${exprText(e)} != 0`;
    else if (pt.k === "res") hint = `match on ok/err, or use '?'`;
    this.error(e, "E170", `${what} needs a bool, but this is ${show(t)}`, hint);
  }

  elementType(t: Type, e: A.Expr): Type {
    const pt = prune(t);
    switch (pt.k) {
      case "list": case "set": return pt.el;
      case "map": return pt.key;
      case "str": return STR;
      case "dyn": return DYN;
      case "var": { const el = fresh(); unify(pt, list(el)); return el; }
      case "opt": this.error(e, "E140", `can't loop over ${show(t)}: it may be none`, `handle none first, e.g. for x in (${exprText(e)} ?? [])`); return DYN;
      case "int": this.error(e, "E110", `can't loop over an int`, `use a range: for i in 0..${exprText(e)}`); return INT;
      default: this.error(e, "E110", `can't loop over ${show(t)}`, "loop over a list, set, map, str, or range (a..b)"); return DYN;
    }
  }

  // ---------- narrowing ----------
  narrowings(c: A.Expr, scope: Scope): { t: [string, VarInfo][]; f: [string, VarInfo][] } {
    const empty = { t: [] as [string, VarInfo][], f: [] as [string, VarInfo][] };
    if (c.k === "binary" && (c.op === "!=" || c.op === "==")) {
      let nameE: A.Expr | undefined;
      if (c.right.k === "none") nameE = c.left;
      else if (c.left.k === "none") nameE = c.right;
      if (nameE?.k === "name") {
        const v = scope.lookup(nameE.name);
        const vt = v ? prune(v.type) : undefined;
        if (v && vt?.k === "opt") {
          const nv: VarInfo = { ...v, type: vt.inner, origin: v.origin ?? v };
          return c.op === "!=" ? { t: [[v.name, nv]], f: [] } : { t: [], f: [[v.name, nv]] };
        }
      }
      return empty;
    }
    if (c.k === "binary" && c.op === "and") {
      const a = this.narrowings(c.left, scope), b = this.narrowings(c.right, scope);
      return { t: [...a.t, ...b.t], f: [] };
    }
    if (c.k === "binary" && c.op === "or") {
      const a = this.narrowings(c.left, scope), b = this.narrowings(c.right, scope);
      return { t: [], f: [...a.f, ...b.f] };
    }
    if (c.k === "unary" && c.op === "not") {
      const a = this.narrowings(c.expr, scope);
      return { t: a.f, f: a.t };
    }
    return empty;
  }

  scopeWith(scope: Scope, entries: [string, VarInfo][]): Scope {
    if (!entries.length) return scope;
    const s = scope.child();
    for (const [n, v] of entries) s.vars.set(n, v);
    return s;
  }

  // ---------- type compatibility with good messages ----------
  expectType(actual: Type, expected: Type, at: A.Pos, what: string): boolean {
    if (assign(actual, expected)) return true;
    const a = prune(actual), e = prune(expected);
    const atText = "k" in at ? exprText(at as A.Expr) : "";
    let msg = `${what} should be ${show(expected)}, but it is ${show(actual)}`;
    let hint: string | undefined;
    let code = "E110";
    if (a.k === "opt" && assign(a.inner, e)) {
      code = "E140";
      msg = `${what} may be none: expected ${show(expected)}, found ${show(actual)}`;
      hint = `handle the none case first: '${atText} ?? <default>', 'if ${atText} != none:', or '${atText}!' to stop if it's none`;
    } else if (a.k === "res" && assign(a.ok, e)) {
      code = "E141";
      msg = `${what} may be an error: expected ${show(expected)}, found ${show(actual)}`;
      hint = `add '?' to pass the error up (${atText}?), '!' to stop on error, or match on ok(v)/err(e)`;
    } else if (e.k === "res" && assign(a, e.ok)) {
      hint = `wrap it: ok(${atText})`;
    } else if (e.k === "str" && (a.k === "int" || a.k === "float" || a.k === "bool")) {
      hint = `convert it: str(${atText}), or use interpolation "{${atText}}"`;
    } else if ((e.k === "int" || e.k === "float") && a.k === "str") {
      hint = `parse it: parse_${e.k}(${atText}) returns ${e.k}? (handle the none case)`;
    } else if (e.k === "int" && a.k === "float") {
      hint = `convert explicitly: int(${atText}) truncates, round(${atText}) rounds`;
    } else if (e.k === "var" && e.constraint) {
      msg = `${what} must be ${CONSTRAINT_TEXT[e.constraint] ?? e.constraint}, but it is ${show(actual)}`;
    } else if (e.k === "unit") {
      msg = `${what} has a value of type ${show(actual)}, but none is expected here`;
    }
    this.error(at, code, msg, hint);
    return false;
  }

  join(a: Type, b: Type, at: A.Pos): Type {
    const pa = prune(a), pb = prune(b);
    if (pa.k === "never") return b;
    if (pb.k === "never") return a;
    if (pa.k === "int" && pb.k === "float") return FLOAT;
    if (pa.k === "float" && pb.k === "int") return FLOAT;
    if (pb.k === "opt" && pa.k !== "opt" && assign(a, pb)) return b;
    if (assign(b, a)) return a;
    if (assign(a, b)) return b;
    this.error(at, "E110", `branches have different types: ${show(a)} and ${show(b)}`, "make every branch produce the same type");
    return DYN;
  }

  visibleNames(scope: Scope): string[] {
    const out: string[] = [];
    for (let s: Scope | undefined = scope; s; s = s.parent) out.push(...s.vars.keys());
    out.push(...this.values.keys(), ...builtinTable().keys(), ...builtinConsts().keys());
    return out;
  }

  // =============================================================================================
  // Expressions

  expr(e: A.Expr, scope: Scope, expected?: Type, asValue = true): Type {
    const t = this.exprInner(e, scope, expected, asValue);
    e.ty = t;
    return t;
  }

  exprInner(e: A.Expr, scope: Scope, expected: Type | undefined, asValue: boolean): Type {
    switch (e.k) {
      case "int": {
        // an int literal where a float is expected becomes a float literal (y: float = 1 stores 1.0)
        if (expected && prune(expected).k === "float" && /^[0-9]+$/.test(e.value)) {
          (e as any).k = "float"; (e as any).value = e.value + ".0";
          return FLOAT;
        }
        return INT;
      }
      case "float": return FLOAT;
      case "bool": return BOOL;
      case "none": {
        const pe = expected ? prune(expected) : undefined;
        if (pe?.k === "opt") return pe;
        return opt(fresh());
      }
      case "str":
        e.parts.forEach((p, i) => {
          if (typeof p === "string") return;
          const t = this.expr(p, scope);
          if (prune(t).k === "unit") this.error(p, "E110", "this expression has no value to put in the string");
          const spec = e.specs?.[i];
          if (spec) {
            const kind = spec[spec.length - 1];
            const pt = prune(t);
            if ("fFeEgG%".includes(kind) && !this.isNum(t)) this.error(p, "E110", `format ':${spec}' needs a number, but this is ${show(t)}`);
            else if ("dxXobc".includes(kind) && pt.k !== "int" && pt.k !== "dyn") this.error(p, "E110", `format ':${spec}' needs an int, but this is ${show(t)}`, pt.k === "float" ? "use :.0f for floats" : undefined);
            else if (pt.k === "opt") this.error(p, "E140", `'${exprText(p)}' may be none; formatting it with ':${spec}' isn't safe`, `use ${exprText(p)} ?? 0`);
          }
        });
        return STR;
      case "name": return this.nameExpr(e, scope, expected);
      case "list": {
        const pe = expected ? prune(expected) : undefined;
        const elExp = pe?.k === "list" ? pe.el : undefined;
        if (e.items.length === 0) return list(elExp ?? fresh());
        let elT: Type | undefined = elExp;
        for (const it of e.items) {
          const t = this.expr(it, scope, elT);
          if (!elT) elT = t;
          else if (elExp) this.expectType(t, elExp, it, "list item");
          else elT = this.join(elT, t, it);
        }
        return list(elT!);
      }
      case "map": {
        const pe = expected ? prune(expected) : undefined;
        let kT: Type | undefined = pe?.k === "map" ? pe.key : undefined;
        let vT: Type | undefined = pe?.k === "map" ? pe.val : undefined;
        if (e.entries.length === 0) return map(kT ?? fresh("hash"), vT ?? fresh());
        for (const [k, v] of e.entries) {
          const kt = this.expr(k, scope, kT);
          const vt = this.expr(v, scope, vT);
          if (!kT) kT = kt; else this.expectType(kt, kT, k, "map key");
          if (!vT) vT = vt; else vT = this.join(vT, vt, v);
        }
        if (!isHashable(kT!)) this.error(e.entries[0][0], "E180", `${show(kT!)} can't be a map key`, "use an int, str, tuple, or a record without var fields");
        return map(kT!, vT!);
      }
      case "tuple": {
        if (e.items.length === 0) return UNIT;
        const pe = expected ? prune(expected) : undefined;
        return tuple(e.items.map((it, i) => this.expr(it, scope, pe?.k === "tuple" ? pe.els[i] : undefined)));
      }
      case "call": return this.callExpr(e, scope, expected);
      case "member": return this.memberExpr(e, scope);
      case "index": return this.indexExpr(e, scope);
      case "slice": {
        const ot = this.expr(e.obj, scope);
        if (e.lo) this.expectType(this.expr(e.lo, scope), INT, e.lo, "slice start");
        if (e.hi) this.expectType(this.expr(e.hi, scope), INT, e.hi, "slice end");
        const pt = prune(ot);
        if (pt.k === "list" || pt.k === "str" || pt.k === "dyn") return pt;
        this.error(e.obj, "E110", `can't slice ${show(ot)}`, "only lists and strings can be sliced");
        return DYN;
      }
      case "binary": return this.binaryExpr(e, scope, expected);
      case "unary": {
        if (e.op === "not") { const t = this.expr(e.expr, scope, BOOL); this.requireBool(t, e.expr, "'not'"); return BOOL; }
        const t = this.expr(e.expr, scope, expected);
        if (!this.isNum(t)) this.error(e, "E180", `can't negate ${show(t)}`, "'-' works on int and float");
        return t;
      }
      case "lambda": return this.lambdaExpr(e, scope, expected);
      case "try": return this.tryExpr(e, scope);
      case "unwrap": {
        const t = prune(this.expr(e.expr, scope));
        if (t.k === "opt") { e.tryKind = "opt"; return t.inner; }
        if (t.k === "res") { e.tryKind = "res"; return t.ok; }
        if (t.k === "dyn") { e.tryKind = "opt"; return DYN; }
        this.error(e, "E180", `'!' unwraps an optional (T?) or result (T!E), but this is ${show(t)}`, "remove the '!'");
        return t;
      }
      case "if": return this.ifExpr(e, scope, expected, asValue);
      case "match": return this.matchExpr(e, scope, expected, asValue);
      case "comp": {
        const sc = scope.child();
        const it = this.expr(e.iter, scope);
        const el = this.elementType(it, e.iter);
        this.bindTarget(e.target, el, sc, false, undefined, true);
        for (const v of sc.vars.values()) v.used = true; // comprehension vars are often only used in the condition
        if (e.cond) this.cond(e.cond, sc, "comprehension filter");
        if (e.isMap) {
          const kt = this.expr(e.elem, sc);
          const vt = this.expr(e.value!, sc);
          return map(kt, vt);
        }
        return list(this.expr(e.elem, sc));
      }
      case "range": {
        this.expectType(this.expr(e.lo, scope, INT), INT, e.lo, "range start");
        this.expectType(this.expr(e.hi, scope, INT), INT, e.hi, "range end");
        return list(INT);
      }
      case "cast": {
        const from = prune(this.expr(e.expr, scope));
        const target = this.toType(e.type, scope.ctx.tparams);
        e.target = target;
        if (from.k !== "dyn" && !assign(from, target)) {
          const tp = prune(target);
          let hint = "'as' converts dyn values (from JSON or extern Python code) to a concrete type";
          if (tp.k === "int" && from.k === "str") hint = `use parse_int(${exprText(e.expr)})`;
          else if (tp.k === "str") hint = `use str(${exprText(e.expr)})`;
          else if (tp.k === "int" && from.k === "float") hint = `use int(${exprText(e.expr)}) or round(${exprText(e.expr)})`;
          this.error(e, "E110", `can't convert ${show(from)} to ${show(target)} with 'as'`, hint);
        }
        return target;
      }
    }
  }

  isNum(t: Type): boolean {
    const p = prune(t);
    if (p.k === "var") { if (!p.constraint) p.constraint = "num"; return p.constraint === "num" || p.constraint === "ord"; }
    return p.k === "int" || p.k === "float" || p.k === "dyn" || p.k === "never" || (p.k === "param" && p.constraint === "num");
  }

  // ---------- names ----------
  nameExpr(e: Extract<A.Expr, { k: "name" }>, scope: Scope, expected?: Type): Type {
    const v = scope.lookup(e.name);
    if (v) {
      this.markUsed(v);
      e.ref = { kind: "var", pyName: v.pyName };
      // closures in loops capture the current value (Tersa semantics), not Python's late binding
      const ctx = scope.ctx;
      if (ctx.isLambda && v.ctx !== ctx && !v.mutable && v.inLoop && ctx.lambda) {
        ctx.lambda.captures ??= [];
        if (!ctx.lambda.captures.includes(v.pyName)) ctx.lambda.captures.push(v.pyName);
      }
      return v.type;
    }
    const entry = this.values.get(e.name);
    if (entry) return this.entryValue(entry, e, expected);
    const bs = builtinTable().get(e.name);
    if (bs) {
      let sig = bs[0];
      if (bs.length > 1) {
        const pe = expected ? prune(expected) : undefined;
        const want = pe?.k === "fn" ? pe.params.length : -1;
        const m = bs.find((b) => b.params.length === want);
        if (!m) {
          this.error(e, "E180", `'${e.name}' has several forms; call it directly or wrap it in a lambda`, `x => ${e.name}(x)`);
          return DYN;
        }
        sig = m;
      }
      if (sig.mut) this.error(e, "E180", `'${e.name}' mutates its argument and can't be used as a value`, `use a lambda: x => ...`);
      e.ref = { kind: "builtin", builtin: sig.builtin! };
      return this.sigAsFnType(sig);
    }
    const c = builtinConsts().get(e.name);
    if (c) { e.ref = { kind: "const", py: c.py }; return c.type; }
    const sugg = closest(e.name, this.visibleNames(scope));
    const hints: Record<string, string> = {
      self: "'self' only exists inside methods: fn Type.method(...)",
      this: "Tersa has no 'this'; methods use 'self'",
      length: "use len(x) or x.len()",
      println: "use print(...)", console: "use print(...)", printf: "use print with interpolation: print(\"x = {x}\")",
      null: "use 'none'", nil: "use 'none'", undefined: "use 'none'",
      Some: "optional values don't need wrapping; just use the value (or none)",
      Ok: "use ok(value)", Err: "use err(error)",
    };
    this.error(e, "E100", `unknown name '${e.name}'`, hints[e.name] ?? (sugg ? `did you mean '${sugg}'?` : undefined));
    return DYN;
  }

  entryValue(entry: ValueEntry, e: A.Expr & { ref?: A.NameRef }, expected?: Type, prefix = ""): Type {
    switch (entry.k) {
      case "fn": e.ref = { kind: "fn", pyName: prefix + entry.sig.pyName }; return this.sigAsFnType(entry.sig);
      case "global": entry.v.used = true; e.ref = { kind: "var", pyName: prefix + entry.v.pyName }; return entry.v.type;
      case "const": e.ref = { kind: "const", py: entry.py }; return entry.type;
      case "record": {
        const { inst, ret } = this.instType(entry.info);
        e.ref = { kind: "record", pyName: prefix + entry.info.pyName };
        const ps = entry.info.fields.map((f) => subst(f.type, inst));
        return fnType(ps, ret, entry.info.fields.filter((f) => !f.hasDefault).length);
      }
      case "variant": {
        const vi = entry.info;
        const { inst, ret } = this.instType(vi.sum);
        if (!vi.hasParens) { e.ref = { kind: "variant", pyName: prefix + vi.pyName, nullary: true }; return ret; }
        e.ref = { kind: "variant", pyName: prefix + vi.pyName, nullary: false };
        return fnType(vi.fields.map((f) => subst(f.type, inst)), ret);
      }
      case "module":
        this.error(e, "E180", `'${entry.alias}' is a module, not a value`, `access its items: ${entry.alias}.<name>`);
        return DYN;
    }
  }

  instType(info: RecordInfo | SumInfo): { inst: Map<string, Type>; ret: Type } {
    const inst = new Map(info.tparams.map((tp) => [tp.name, fresh(tp.constraint)] as [string, Type]));
    return { inst, ret: { k: "named", name: info.id, args: info.tparams.map((tp) => inst.get(tp.name)!) } };
  }

  sigAsFnType(sig: FnSig): Type {
    this.ensureInferred(sig);
    const inst = new Map(sig.tparams.map((tp) => [tp.name, fresh(tp.constraint)] as [string, Type]));
    return fnType(sig.params.map((p) => subst(p.type, inst)), subst(sig.ret, inst), sig.params.filter((p) => !p.hasDefault).length);
  }

  // ---------- member / index ----------
  memberExpr(e: Extract<A.Expr, { k: "member" }>, scope: Scope): Type {
    // module-qualified access
    if (e.obj.k === "name" && !scope.lookup(e.obj.name)) {
      const m = this.values.get(e.obj.name);
      if (m?.k === "module") {
        const entry = m.mod.values.get(e.name);
        if (!entry) {
          const sugg = closest(e.name, m.mod.values.keys());
          this.error(e, "E192", `module '${m.mod.name}' has no public item '${e.name}'`, sugg ? `did you mean '${sugg}'?` : undefined);
          return DYN;
        }
        e.memberKind = "module";
        const holder: any = {};
        const t = this.entryValue(entry, holder, undefined, m.alias + ".");
        e.moduleRef = holder.ref;
        return t;
      }
    }
    const ot = prune(this.expr(e.obj, scope));
    if (ot.k === "dyn") { e.memberKind = "dyn"; return DYN; }
    const info = this.typeInfoOf(ot);
    if (info?.kind === "record") {
      const f = info.fields.find((x) => x.name === e.name);
      if (f) { e.memberKind = "field"; e.pyName = pyAttr(f.name); return this.specialize(info, ot, f.type); }
    }
    if (info) {
      const m = info.methods.get(e.name);
      if (m) {
        this.ensureInferred(m, e);
        e.memberKind = "method"; e.pyName = pyAttr(e.name);
        const inst = new Map<string, Type>();
        const nt = ot as Type & { k: "named" };
        info.tparams.forEach((tp, i) => inst.set(tp.name, nt.args[i] ?? DYN));
        for (const tp of m.tparams.slice(info.tparams.length)) inst.set(tp.name, fresh(tp.constraint));
        return fnType(m.params.map((p) => subst(p.type, inst)), subst(m.ret, inst));
      }
      if (info.kind === "sum") {
        const withField = info.variants.filter((v) => v.fields.some((f) => f.name === e.name));
        if (withField.length) {
          this.error(e, "E102", `can't access '.${e.name}' on ${info.name}: only some variants have it`,
            `match first: match ${exprText(e.obj)}:\n      ${withField[0].name}(${withField[0].fields.map((f) => f.name).join(", ")}): ...`);
          return DYN;
        }
      }
    }
    if (ot.k === "opt") {
      const inner = this.typeInfoOf(ot.inner);
      if (inner?.kind === "record" && inner.fields.some((f) => f.name === e.name)) {
        this.error(e, "E140", `'${exprText(e.obj)}' may be none, so '.${e.name}' isn't safe`,
          `check first: if ${exprText(e.obj)} != none: ...  (or ${exprText(e.obj)}!.${e.name} to stop if none)`);
        return DYN;
      }
    }
    this.unknownMember(e, ot, scope, false);
    return DYN;
  }

  unknownMember(e: A.Expr & { name: string }, ot: Type, scope: Scope, isCall: boolean) {
    const info = this.typeInfoOf(ot);
    const cands: string[] = [];
    if (info?.kind === "record") cands.push(...info.fields.map((f) => f.name));
    if (info) cands.push(...info.methods.keys());
    for (const [n, sigs] of builtinTable()) if (sigs.some((s) => s.params.length && kindMatches(s.params[0].type, ot))) cands.push(n);
    for (const [n, v] of this.values) if (v.k === "fn" && v.sig.params.length && assignQuiet(ot, instFirst(v.sig))) cands.push(n);
    const pyHints: Record<string, string> = {
      append: "use push(x)", length: "use len()", size: "use len()", strip: "use trim()", toUpperCase: "use upper()",
      toLowerCase: "use lower()", startswith: "use starts_with()", endswith: "use ends_with()", includes: "use 'x in xs'",
      indexOf: "use index_of() for lists or find() for strings", forEach: "use a for loop", reduce: "use fold(init, (acc, x) => ...)",
      splitlines: "use lines()", sorted: "use sort()", has: "use 'key in m'", get_or: "use m.get(k) ?? default",
      to_string: "use str(x)", toString: "use str(x)", isdigit: "use is_digit()", isalpha: "use is_alpha()",
      add: prune(ot).k === "list" ? "use push(x)" : "", format: "use string interpolation: \"{x}\"",
    };
    const sugg = closest(e.name, cands);
    const hint = pyHints[e.name] || (sugg ? `did you mean '${sugg}'?` : undefined);
    this.error(e, "E102", `${show(ot)} has no ${isCall ? "method" : "field"} '${e.name}'`, hint);
  }

  indexExpr(e: Extract<A.Expr, { k: "index" }>, scope: Scope): Type {
    const ot = prune(this.expr(e.obj, scope));
    switch (ot.k) {
      case "list": this.expectType(this.expr(e.index, scope, INT), INT, e.index, "list index"); return ot.el;
      case "str": this.expectType(this.expr(e.index, scope, INT), INT, e.index, "string index"); return STR;
      case "map": this.expectType(this.expr(e.index, scope, ot.key), ot.key, e.index, "map key"); return ot.val;
      case "dyn": this.expr(e.index, scope); return DYN;
      case "tuple": {
        let idx: number | undefined;
        if (e.index.k === "int") idx = Number(e.index.value);
        this.expr(e.index, scope);
        if (idx === undefined || idx < 0 || idx >= ot.els.length) {
          this.error(e.index, "E110", `tuple index must be a literal between 0 and ${ot.els.length - 1}`);
          return DYN;
        }
        return ot.els[idx];
      }
      case "opt":
        this.expr(e.index, scope);
        this.error(e, "E140", `'${exprText(e.obj)}' may be none, so indexing it isn't safe`, `check it first: if ${exprText(e.obj)} != none: ...`);
        return DYN;
      case "set":
        this.error(e, "E110", "sets can't be indexed", "use 'x in s' to test membership, or s.to_list()");
        return DYN;
      default:
        this.expr(e.index, scope);
        this.error(e.obj, "E110", `can't index ${show(ot)}`);
        return DYN;
    }
  }

  // ---------- operators ----------
  binaryExpr(e: Extract<A.Expr, { k: "binary" }>, scope: Scope, expected?: Type): Type {
    const op = e.op;
    if (op === "and" || op === "or") {
      const lt = this.expr(e.left, scope, BOOL);
      this.requireBool(lt, e.left, `'${op}'`);
      const n = this.narrowings(e.left, scope);
      const rs = this.scopeWith(scope, op === "and" ? n.t : n.f);
      const rt = this.expr(e.right, rs, BOOL);
      this.requireBool(rt, e.right, `'${op}'`);
      return BOOL;
    }
    if (op === "??") {
      const lt = prune(this.expr(e.left, scope));
      if (lt.k === "opt") {
        const rt = this.expr(e.right, scope, lt.inner);
        const prt = prune(rt);
        if (prt.k === "opt") { this.expectType(rt, lt, e.right, "fallback"); return lt; }
        this.expectType(rt, lt.inner, e.right, "fallback value");
        return prune(lt.inner).k === "int" && prt.k === "float" ? FLOAT : lt.inner;
      }
      if (lt.k === "res") {
        const rt = this.expr(e.right, scope, lt.ok);
        this.expectType(rt, lt.ok, e.right, "fallback value");
        return lt.ok;
      }
      if (lt.k === "dyn") { this.expr(e.right, scope); return DYN; }
      this.expr(e.right, scope);
      this.error(e, "E180", `'??' needs an optional (T?) or result (T!E) on the left, but this is ${show(lt)}`, "remove the '?? ...' part; the value can't be none");
      return lt;
    }
    if (op === "in" || op === "not in") {
      const rt = prune(this.expr(e.right, scope));
      let elT: Type = DYN;
      if (rt.k === "list" || rt.k === "set") elT = rt.el;
      else if (rt.k === "map") elT = rt.key;
      else if (rt.k === "str") elT = STR;
      else if (rt.k !== "dyn") this.error(e.right, "E110", `'${op}' needs a list, set, map, or str on the right, but this is ${show(rt)}`);
      const lt = this.expr(e.left, scope, elT);
      this.expectType(lt, elT, e.left, `left side of '${op}'`);
      return BOOL;
    }
    if (op === "==" || op === "!=") {
      const lt = this.expr(e.left, scope);
      const rt = this.expr(e.right, scope, lt);
      const pl = prune(lt), pr = prune(rt);
      if (e.left.k === "none" || e.right.k === "none") {
        const other = e.left.k === "none" ? pr : pl;
        const otherE = e.left.k === "none" ? e.right : e.left;
        if (other.k !== "opt" && other.k !== "dyn" && other.k !== "var") {
          this.error(e, "E140", `'${exprText(otherE)}' is ${show(other)}, which can never be none`, `remove this check${pl.k === "res" || pr.k === "res" ? ", or match on ok/err" : ""}`);
        }
        return BOOL;
      }
      if (!assign(rt, lt) && !assign(lt, rt) && !(this.isNum(lt) && this.isNum(rt))) {
        this.error(e, "E110", `comparing ${show(lt)} with ${show(rt)} is always ${op === "==" ? "false" : "true"}`,
          pl.k === "str" || pr.k === "str" ? "convert one side first, e.g. str(x) or parse_int(s)" : "compare values of the same type");
      }
      if (pl.k === "fn") this.error(e, "E110", "functions can't be compared");
      return BOOL;
    }
    if (COMPARE_OPS.has(op)) {
      const lt = this.expr(e.left, scope);
      const rt = this.expr(e.right, scope, lt);
      const ok = (this.isNum(lt) && this.isNum(rt)) || (unify(lt, rt) && satisfies(lt, "ord"));
      if (!ok) {
        const pl = prune(lt), pr = prune(rt);
        let hint: string | undefined;
        if (pl.k === "opt" || pr.k === "opt") hint = "one side may be none; handle that first (x ?? default, or check != none)";
        else if ((pl.k === "str" && this.isNum(pr)) || (pr.k === "str" && this.isNum(pl))) hint = "convert the string first: parse_int(s) / parse_float(s)";
        this.error(e, "E110", `can't compare ${show(lt)} ${op} ${show(rt)}`, hint);
      }
      return BOOL;
    }
    // arithmetic
    const lt = this.expr(e.left, scope, expected && this.isNumExpected(expected) ? expected : undefined);
    const rt = this.expr(e.right, scope, prune(lt).k === "list" ? lt : undefined);
    return this.binaryType(op, lt, rt, e);
  }

  isNumExpected(t: Type) { const p = prune(t); return p.k === "int" || p.k === "float"; }

  binaryType(op: string, lt: Type, rt: Type, at: A.Pos): Type {
    const pl = prune(lt), pr = prune(rt);
    if (pl.k === "dyn" || pr.k === "dyn") return DYN;
    if (pl.k === "never") return rt;
    if (pr.k === "never") return lt;
    const atE = at as A.Expr;
    if (op === "+" && pl.k === "str" && pr.k === "str") return STR;
    if (op === "+" && (pl.k === "str" || pr.k === "str")) {
      const other = pl.k === "str" ? pr : pl;
      const otherE = atE.k === "binary" ? (pl.k === "str" ? atE.right : atE.left) : undefined;
      this.error(at, "E110", `can't add str and ${show(other)}`,
        otherE ? `use interpolation: "...{${exprText(otherE)}}"  or convert: str(${exprText(otherE)})` : "use string interpolation \"...{x}\"");
      return STR;
    }
    if (op === "+" && pl.k === "list") {
      if (pr.k !== "list" || !unify(pl.el, pr.el)) {
        this.error(at, "E110", `can't add ${show(rt)} to ${show(lt)}`, pr.k !== "list" ? "to add one item use push(x), or wrap it: xs + [x]" : undefined);
      }
      return lt;
    }
    if (op === "*" && ((pl.k === "str" && pr.k === "int") || (pl.k === "list" && pr.k === "int"))) return lt;
    if (op === "*" && pr.k === "str" && pl.k === "int") return rt;
    if (pl.k === "opt" || pr.k === "opt") {
      const which = pl.k === "opt" ? (atE.k === "binary" ? atE.left : atE) : (atE.k === "binary" ? atE.right : atE);
      this.error(which, "E140", `'${exprText(which)}' may be none, so '${op}' isn't safe`, `use '${exprText(which)} ?? 0' or check '!= none' first`);
      return DYN;
    }
    if (pl.k === "res" || pr.k === "res") {
      const which = pl.k === "res" ? (atE.k === "binary" ? atE.left : atE) : (atE.k === "binary" ? atE.right : atE);
      this.error(which, "E141", `'${exprText(which)}' may be an error, so '${op}' isn't safe`, `use '${exprText(which)}?' to propagate the error`);
      return DYN;
    }
    if (!this.isNum(lt) || !this.isNum(rt)) {
      this.error(at, "E110", `can't use '${op}' on ${show(lt)} and ${show(rt)}`,
        pl.k === "set" || pr.k === "set" ? "for sets use union(), intersect(), difference()" : op === "+" && pl.k === "map" ? "use merge(a, b)" : undefined);
      return DYN;
    }
    if (op === "/") return FLOAT;
    const vl = prune(lt), vr = prune(rt);
    if (vl.k === "param" || vr.k === "param") {
      if (!unify(lt, rt)) this.error(at, "E110", `can't mix ${show(lt)} and ${show(rt)}`);
      return lt;
    }
    if (vl.k === "var" && vr.k !== "var") { unify(vl, vr); return vr; }
    if (vr.k === "var" && vl.k !== "var") { unify(vr, vl); return vl; }
    if (vl.k === "var" && vr.k === "var") { unify(vl, vr); return vl; }
    if (vl.k === "float" || vr.k === "float") return FLOAT;
    return INT;
  }

  // ---------- try ----------
  tryExpr(e: Extract<A.Expr, { k: "try" }>, scope: Scope): Type {
    const t = prune(this.expr(e.expr, scope));
    const ctx = scope.ctx;
    if (ctx.isTop || ctx.isLambda || !ctx.decl) {
      this.error(e, "E160", "'?' can only be used inside a function that returns an optional (T?) or a result (T!E)",
        ctx.isTop ? "at the top level use '!' to stop on errors, or match on the result" : "move this into a named function, or use '!' / '??'");
      return t.k === "opt" ? t.inner : t.k === "res" ? t.ok : DYN;
    }
    ctx.usesTry = true;
    if (ctx.inferred) {
      if (t.k === "opt") { e.tryKind = "opt"; ctx.inferred.opt = true; return t.inner; }
      if (t.k === "res") {
        e.tryKind = "res";
        if (ctx.inferred.err && !assign(t.err, ctx.inferred.err)) this.error(e, "E160", `error type ${show(t.err)} doesn't match the earlier error type ${show(ctx.inferred.err)}`);
        ctx.inferred.err ??= t.err;
        return t.ok;
      }
    }
    const ret = prune(ctx.ret ?? UNIT);
    if (t.k === "opt") {
      e.tryKind = "opt";
      if (ret.k !== "opt") this.error(e, "E160", `'?' on an optional returns none early, but '${ctx.name}' returns ${show(ret)}`,
        ret.k === "res" ? `convert to a result first: (${exprText(e.expr)} ?? <default>) or match` : `change the return type to ${show(ret)}?, or use '??' to give a default`);
      return t.inner;
    }
    if (t.k === "res") {
      e.tryKind = "res";
      if (ret.k !== "res") this.error(e, "E160", `'?' on a result returns the error early, but '${ctx.name}' returns ${show(ret)}`,
        `change the return type to ${show(ret)}!${show(t.err)}, or handle the error with match / '!'`);
      else if (!assign(t.err, ret.err)) this.error(e, "E160", `error type ${show(t.err)} doesn't match '${ctx.name}''s error type ${show(ret.err)}`);
      return t.ok;
    }
    if (t.k === "dyn") { e.tryKind = "opt"; return DYN; }
    this.error(e, "E160", `'?' needs an optional (T?) or result (T!E), but this is ${show(t)}`, "remove the '?'");
    return t;
  }

  // ---------- lambda ----------
  lambdaExpr(e: Extract<A.Expr, { k: "lambda" }>, scope: Scope, expected?: Type): Type {
    const pe = expected ? prune(expected) : undefined;
    const ctx = this.newCtx({ name: "lambda", isLambda: true, lambda: e, tparams: scope.ctx.tparams });
    ctx.ret = pe?.k === "fn" ? pe.ret : fresh();
    const sc = new Scope(ctx, scope);
    e.captures = undefined;
    if (pe?.k === "fn" && pe.params.length !== e.params.length) {
      this.error(e, "E111", `this lambda takes ${e.params.length} parameter(s), but ${pe.params.length} are expected here`,
        pe.params.length === 2 ? "e.g. (acc, x) => ..." : pe.params.length === 1 ? "e.g. x => ..." : undefined);
    }
    const ps = e.params.map((p, i) => {
      let t: Type;
      if (p.type) {
        t = this.toType(p.type, scope.ctx.tparams);
        if (pe?.k === "fn" && pe.params[i]) this.expectType(pe.params[i], t, p.pos, `parameter '${p.name}'`);
      } else t = pe?.k === "fn" && pe.params[i] ? pe.params[i] : fresh();
      sc.vars.set(p.name, { name: p.name, pyName: pyId(p.name), type: t, mutable: false, ctx, used: true, pos: p.pos, isGlobal: false, inLoop: false, isParam: true });
      return t;
    });
    if (e.body.k === "match" || (e.body.k === "if" && !e.body.inline)) {
      this.error(e.body, "E180", "a lambda body must be a single expression", "use an inline 'if c: a else: b', or move the logic into a named fn");
    }
    const bodyT = this.expr(e.body, sc, ctx.ret);
    if (pe?.k === "fn" && prune(pe.ret).k !== "unit") this.expectType(bodyT, pe.ret, e.body, "lambda result");
    else if (!(pe?.k === "fn")) unify(ctx.ret, bodyT);
    return fnType(ps, pe?.k === "fn" && prune(pe.ret).k === "unit" ? UNIT : bodyT);
  }

  // ---------- if / match ----------
  ifExpr(e: Extract<A.Expr, { k: "if" }>, scope: Scope, expected: Type | undefined, asValue: boolean): Type {
    let falseScope = scope;
    const types: { t: Type; at: A.Pos }[] = [];
    for (const br of e.branches) {
      this.cond(br.cond, falseScope, "if condition");
      const n = this.narrowings(br.cond, falseScope);
      const ts = this.scopeWith(falseScope, n.t);
      if (asValue) types.push({ t: this.blockValue(br.body, ts, expected), at: br.body.stmts[br.body.stmts.length - 1] ?? br.cond });
      else this.checkBlock(br.body, ts);
      falseScope = this.scopeWith(falseScope, n.f);
    }
    if (e.else) {
      if (asValue) types.push({ t: this.blockValue(e.else, falseScope, expected), at: e.else.stmts[e.else.stmts.length - 1] ?? e });
      else this.checkBlock(e.else, falseScope);
    }
    if (!asValue) {
      return e.else && e.branches.every((b) => this.blockTerminates(b.body)) && this.blockTerminates(e.else) ? NEVER : UNIT;
    }
    if (!e.else) {
      // used as a value: needs an else. (A unit-typed if is fine.)
      if (types.every((x) => prune(x.t).k === "unit" || prune(x.t).k === "never")) return UNIT;
      this.error(e, "E150", "this 'if' is used as a value, so it needs an 'else' branch", "add 'else: <value>'");
      return types[0]?.t ?? DYN;
    }
    let t: Type = NEVER;
    for (const x of types) t = expected && prune(expected).k !== "var" ? (this.expectType(x.t, expected, x.at, "branch value"), expected) : this.join(t, x.t, x.at);
    return t;
  }

  matchExpr(e: Extract<A.Expr, { k: "match" }>, scope: Scope, expected: Type | undefined, asValue: boolean): Type {
    const st = this.expr(e.subject, scope);
    const types: { t: Type; at: A.Pos }[] = [];
    let catchAllSeen = false;
    for (const arm of e.arms) {
      if (catchAllSeen) this.error(arm.pattern, "E131", "this arm is unreachable because an earlier arm matches everything", "move the catch-all ('_' or a plain name) arm to the end");
      const sc = scope.child();
      this.checkPattern(arm.pattern, st, sc);
      for (const v of sc.vars.values()) sc.ctx.locals.push(v);
      if (arm.guard) this.cond(arm.guard, sc, "match guard");
      if (!arm.guard && irrefutable(arm.pattern)) catchAllSeen = true;
      if (asValue) types.push({ t: this.blockValue(arm.body, sc, expected), at: arm.body.stmts[arm.body.stmts.length - 1] ?? arm.pos });
      else this.checkBlock(arm.body, sc);
    }
    const missing = this.missingCases(e.arms.filter((a) => !a.guard).map((a) => a.pattern), st);
    if (missing.length) {
      const pst = prune(st);
      const simple = missing.length === 1 && missing[0] === "_";
      this.error(e, "E130", simple ? `match on ${show(st)} is not exhaustive` : `match is not exhaustive: missing ${missing.join(", ")}`,
        simple ? "add a catch-all arm at the end: _: ..." : `add arm${missing.length > 1 ? "s" : ""} for ${missing.join(", ")} (or a catch-all '_: ...')${pst.k === "named" ? "" : ""}`);
    }
    if (!asValue) return e.arms.length && e.arms.every((a) => this.blockTerminates(a.body)) ? NEVER : UNIT;
    let t: Type = NEVER;
    for (const x of types) t = expected && prune(expected).k !== "var" ? (this.expectType(x.t, expected, x.at, "match arm value"), expected) : this.join(t, x.t, x.at);
    return t;
  }

  checkPattern(p: A.Pattern, t: Type, sc: Scope): void {
    const pt = prune(t);
    switch (p.k) {
      case "pwild": return;
      case "pbind": {
        // a binding declares a new name for the rest of this arm
        if (sc.lookup(p.name) && sc.lookup(p.name)!.ctx === sc.ctx) {
          this.error(p, "E122", `pattern binds '${p.name}', which is already defined in this function`, `use a different name, e.g. '${p.name}2'`);
          return;
        }
        if (/^[A-Z]/.test(p.name)) return;
        sc.vars.set(p.name, { name: p.name, pyName: pyId(p.name), type: t, mutable: false, ctx: sc.ctx, used: false, pos: p, isGlobal: sc.ctx.isTop, inLoop: sc.inLoop(), isParam: false });
        return;
      }
      case "plit": {
        const lt = this.expr(p.value, sc);
        const target = pt.k === "opt" ? pt.inner : t;
        if (!assign(lt, target) && !(this.isNum(lt) && this.isNum(target))) this.error(p, "E110", `pattern ${exprText(p.value)} (${show(lt)}) can't match a value of type ${show(t)}`);
        return;
      }
      case "pnone":
        if (pt.k !== "opt" && pt.k !== "dyn") this.error(p, "E140", `${show(t)} can never be none`, "remove this arm");
        return;
      case "psome":
        if (pt.k === "opt") return this.checkPattern(p.inner, pt.inner, sc);
        if (pt.k === "dyn") return this.checkPattern(p.inner, DYN, sc);
        this.error(p, "E110", `some(...) matches an optional, but this is ${show(t)}`);
        return;
      case "pok": case "perr":
        if (pt.k === "res") return this.checkPattern(p.inner, p.k === "pok" ? pt.ok : pt.err, sc);
        if (pt.k === "dyn") return this.checkPattern(p.inner, DYN, sc);
        this.error(p, "E110", `${p.k === "pok" ? "ok" : "err"}(...) matches a result (T!E), but this is ${show(t)}`);
        return;
      case "ptuple":
        if (pt.k === "tuple" && pt.els.length === p.els.length) { p.els.forEach((el, i) => this.checkPattern(el, pt.els[i], sc)); return; }
        if (pt.k === "dyn") { p.els.forEach((el) => this.checkPattern(el, DYN, sc)); return; }
        if (pt.k === "list") { p.els.forEach((el) => this.checkPattern(el, pt.el, sc)); return; }
        this.error(p, "E110", `a ${p.els.length}-tuple pattern can't match ${show(t)}`);
        return;
      case "por":
        for (const alt of p.alts) {
          if (bindsNames(alt)) this.error(alt, "E180", "alternatives (a | b) can't bind names", "split them into separate arms");
          this.checkPattern(alt, t, sc);
        }
        return;
      case "pctor": {
        const target = pt.k === "opt" ? prune(pt.inner) : pt;
        let entry: ValueEntry | undefined;
        let prefix = "";
        if (p.name.includes(".")) {
          const [alias, n] = p.name.split(".");
          const m = this.values.get(alias);
          if (m?.k === "module") { entry = m.mod.values.get(n); prefix = alias + "."; }
        } else entry = this.values.get(p.name);
        const bare = p.name.split(".").pop()!;
        if (!entry || (entry.k !== "variant" && entry.k !== "record")) {
          const info = this.typeInfoOf(target);
          const cands = info?.kind === "sum" ? info.variants.map((v) => v.name) : [...this.values.keys()];
          const sugg = closest(bare, cands);
          const hints: Record<string, string> = { Some: "write some(x) (lowercase), or just a name to bind the value after a 'none' arm", None: "write none (lowercase)", Ok: "write ok(x)", Err: "write err(e)" };
          this.error(p, "E100", `unknown variant '${p.name}'`, hints[bare] ?? (sugg ? `did you mean '${sugg}'?` : info?.kind === "sum" ? `variants of ${info.name}: ${info.variants.map((v) => v.name).join(", ")}` : undefined));
          p.args.forEach((a) => this.checkPattern(a, DYN, sc));
          return;
        }
        const ownerInfo = entry.k === "variant" ? entry.info.sum : entry.info;
        const fields = entry.k === "variant" ? entry.info.fields : entry.info.fields;
        p.variant = { typeName: ownerInfo.name, variant: bare, pyName: prefix + (entry.k === "variant" ? entry.info.pyName : entry.info.pyName) };
        if (target.k === "dyn") { p.args.forEach((a) => this.checkPattern(a, DYN, sc)); return; }
        if (target.k !== "named" || target.name !== ownerInfo.id) {
          this.error(p, "E110", `pattern ${bare} belongs to ${ownerInfo.name}, but the value is ${show(t)}`);
          p.args.forEach((a) => this.checkPattern(a, DYN, sc));
          return;
        }
        if (p.hasParens && p.args.length !== fields.length) {
          this.error(p, "E111", `${bare} has ${fields.length} field(s) (${fields.map((f) => f.name).join(", ")}), but the pattern has ${p.args.length}`,
            fields.length ? `${bare}(${fields.map((f) => f.name).join(", ")})` : `write just ${bare}`);
        }
        if (entry.k === "variant" && !entry.info.hasParens && p.hasParens) this.error(p, "E111", `${bare} has no fields; write just '${bare}'`);
        p.args.forEach((a, i) => this.checkPattern(a, fields[i] ? this.specialize(ownerInfo, target, fields[i].type) : DYN, sc));
        return;
      }
    }
  }

  /** Which cases are not covered by these (unguarded) patterns? */
  missingCases(pats: A.Pattern[], t: Type): string[] {
    const flat = pats.flatMap((p) => (p.k === "por" ? p.alts : [p]));
    if (flat.some(irrefutable)) return [];
    const pt = prune(t);
    switch (pt.k) {
      case "dyn": return ["_"];
      case "bool": {
        const vals = new Set(flat.filter((p) => p.k === "plit" && p.value.k === "bool").map((p) => ((p as any).value.value as boolean)));
        const out: string[] = [];
        if (!vals.has(true)) out.push("true");
        if (!vals.has(false)) out.push("false");
        return out;
      }
      case "opt": {
        const out: string[] = [];
        if (!flat.some((p) => p.k === "pnone")) out.push("none");
        const inner = flat.filter((p) => p.k !== "pnone").map((p) => (p.k === "psome" ? p.inner : p));
        const m = this.missingCases(inner, pt.inner);
        if (m.length) out.push(...(m.length === 1 && m[0] === "_" ? ["some(_)"] : m));
        return out;
      }
      case "res": {
        const okP = flat.filter((p) => p.k === "pok").map((p) => (p as any).inner as A.Pattern);
        const errP = flat.filter((p) => p.k === "perr").map((p) => (p as any).inner as A.Pattern);
        const out: string[] = [];
        if (!okP.length) out.push("ok(_)"); else out.push(...this.missingCases(okP, pt.ok).map((m) => `ok(${m})`));
        if (!errP.length) out.push("err(_)"); else out.push(...this.missingCases(errP, pt.err).map((m) => `err(${m})`));
        return out;
      }
      case "named": {
        const info = this.typeInfoOf(pt);
        if (!info) return ["_"];
        const ctors = info.kind === "sum" ? info.variants : [{ name: info.name, fields: info.fields, hasParens: true } as unknown as VariantInfo];
        const out: string[] = [];
        for (const v of ctors) {
          const forV = flat.filter((p): p is Extract<A.Pattern, { k: "pctor" }> => p.k === "pctor" && p.name.split(".").pop() === v.name);
          const label = v.fields.length ? `${v.name}(${v.fields.map(() => "_").join(", ")})` : v.name;
          if (!forV.length) { out.push(label); continue; }
          if (forV.some((p) => !p.hasParens || p.args.every(irrefutable))) continue;
          if (v.fields.length === 1) {
            const m = this.missingCases(forV.map((p) => p.args[0]).filter(Boolean), this.specialize(info, pt, v.fields[0].type));
            out.push(...m.map((x) => `${v.name}(${x})`));
          } else out.push(label);
        }
        return out;
      }
      default:
        return ["_"];
    }
  }

  // ---------- calls ----------
  callExpr(e: Extract<A.Expr, { k: "call" }>, scope: Scope, expected?: Type): Type {
    const c = e.callee;
    if (c.k === "member") {
      // module.fn(...)
      if (c.obj.k === "name" && !scope.lookup(c.obj.name)) {
        const m = this.values.get(c.obj.name);
        if (m?.k === "module") {
          const entry = m.mod.values.get(c.name);
          if (!entry) {
            const sugg = closest(c.name, m.mod.values.keys());
            this.error(c, "E192", `module '${m.mod.name}' has no public item '${c.name}'`, sugg ? `did you mean '${sugg}'?` : undefined);
            e.args.forEach((a) => this.expr(a.value, scope));
            return DYN;
          }
          c.memberKind = "module";
          return this.callEntry(e, entry, scope, expected, m.alias + ".");
        }
      }
      const ot = prune(this.expr(c.obj, scope));
      const recvArg: A.Arg = { value: c.obj };
      if (ot.k === "dyn") {
        c.memberKind = "dyn";
        e.resolved = { kind: "dyn" };
        e.args.forEach((a) => this.expr(a.value, scope));
        return DYN;
      }
      const info = this.typeInfoOf(ot);
      // record.with(field=value)
      if (info?.kind === "record" && c.name === "with" && !info.methods.has("with")) {
        e.resolved = { kind: "with" };
        for (const a of e.args) {
          if (!a.name) { this.error(a.value, "E113", "with() takes named arguments only", `${exprText(c.obj)}.with(${info.fields[0]?.name ?? "field"}=...)`); this.expr(a.value, scope); continue; }
          const f = info.fields.find((x) => x.name === a.name);
          if (!f) {
            const sugg = closest(a.name, info.fields.map((x) => x.name));
            this.error(a.value, "E113", `${info.name} has no field '${a.name}'`, sugg ? `did you mean '${sugg}'?` : undefined);
            this.expr(a.value, scope);
            continue;
          }
          const ft = this.specialize(info, ot, f.type);
          this.expectType(this.expr(a.value, scope, ft), ft, a.value, `field '${a.name}'`);
        }
        return ot;
      }
      // a field holding a function
      if (info?.kind === "record") {
        const f = info.fields.find((x) => x.name === c.name);
        if (f) {
          c.memberKind = "field"; c.pyName = pyAttr(f.name);
          const ft = this.specialize(info, ot, f.type);
          c.ty = ft;
          return this.callValue(e, ft, scope);
        }
      }
      // methods
      if (info) {
        const m = info.methods.get(c.name);
        if (m) {
          c.memberKind = "method"; c.pyName = pyAttr(c.name);
          e.resolved = { kind: "method", pyName: pyAttr(c.name) };
          const nt = ot as Type & { k: "named" };
          const pre = new Map(info.tparams.map((tp, i) => [tp.name, nt.args[i] ?? DYN] as [string, Type]));
          return this.callSig(e, m, e.args, scope, pre);
        }
      }
      // method syntax on other types: built-in methods first, then user functions taking this type first
      const bs = builtinTable().get(c.name);
      const userFn = this.values.get(c.name);
      if (bs) {
        const sig = this.pickOverload(bs, e.args.length + 1, ot);
        if (sig) return this.callBuiltin(e, sig, [recvArg, ...e.args], scope, true);
      }
      if (userFn?.k === "fn" && userFn.sig.params.length && assignQuiet(ot, instFirst(userFn.sig))) {
        e.resolved = { kind: "ufcs", pyName: userFn.sig.pyName };
        return this.callSig(e, userFn.sig, [recvArg, ...e.args], scope, undefined, true);
      }
      if (bs) {
        const forms = bs.filter((b) => b.params.length && kindMatches(b.params[0].type, ot));
        if (forms.length) {
          this.error(e, "E111", `wrong number of arguments for ${c.name}()`, `forms: ${forms.map((f) => sigText(f)).join(" | ")}`);
          e.args.forEach((a) => this.expr(a.value, scope));
          return DYN;
        }
      }
      if (ot.k === "opt" && (this.typeInfoOf(ot.inner)?.methods.has(c.name) || (bs && this.pickOverload(bs, e.args.length + 1, ot.inner)))) {
        this.error(c, "E140", `'${exprText(c.obj)}' may be none, so calling .${c.name}() isn't safe`,
          `check first: if ${exprText(c.obj)} != none: ..., or use ${exprText(c.obj)}!.${c.name}(...)`);
        e.args.forEach((a) => this.expr(a.value, scope));
        return DYN;
      }
      if (ot.k === "res" && bs && this.pickOverload(bs, e.args.length + 1, ot.ok)) {
        this.error(c, "E141", `'${exprText(c.obj)}' may be an error, so calling .${c.name}() isn't safe`, `use ${exprText(c.obj)}?.${c.name}(...) inside a function returning a result, or ${exprText(c.obj)}!.${c.name}(...)`);
        e.args.forEach((a) => this.expr(a.value, scope));
        return DYN;
      }
      this.unknownMember(c, ot, scope, true);
      e.args.forEach((a) => this.expr(a.value, scope));
      return DYN;
    }

    if (c.k === "name") {
      const v = scope.lookup(c.name);
      if (v) {
        this.markUsed(v);
        c.ref = { kind: "var", pyName: v.pyName };
        c.ty = v.type;
        const sig: FnSig | undefined = (v as any).sig;
        if (sig) { e.resolved = { kind: "fn", pyName: v.pyName }; return this.callSig(e, sig, e.args, scope); }
        return this.callValue(e, v.type, scope);
      }
      const entry = this.values.get(c.name);
      if (entry) return this.callEntry(e, entry, scope, expected, "");
      const bs = builtinTable().get(c.name);
      if (bs) {
        if (c.name === "print") return this.callBuiltin(e, bs[0], e.args, scope, false);
        const firstT = e.args[0] && !e.args[0].name ? prune(this.peekType(e.args[0].value, scope)) : undefined;
        if ((c.name === "int" || c.name === "float") && firstT?.k === "str") {
          this.error(e, "E110", `${c.name}() converts numbers; to parse text use parse_${c.name}(s), which returns ${c.name}? (none if the text isn't a number)`,
            `parse_${c.name}(${exprText(e.args[0].value)}) ?? ${c.name === "int" ? "0" : "0.0"}`);
          return c.name === "int" ? INT : FLOAT;
        }
        const sig = this.pickOverload(bs, e.args.length, firstT);
        if (!sig) {
          this.error(e, "E111", `no form of ${c.name}() takes ${e.args.length} argument(s)${firstT ? ` starting with ${show(firstT)}` : ""}`,
            `forms: ${bs.map((f) => sigText(f)).join(" | ")}${c.name === "int" && firstT?.k === "str" ? ".  To parse text use parse_int(s)" : ""}`);
          e.args.forEach((a) => this.expr(a.value, scope));
          return DYN;
        }
        return this.callBuiltin(e, sig, e.args, scope, false);
      }
      this.nameExpr(c, scope); // reports unknown name
      e.args.forEach((a) => this.expr(a.value, scope));
      return DYN;
    }
    const ct = this.expr(c, scope);
    return this.callValue(e, ct, scope);
  }

  /** Type an expression for overload selection (re-checked later in context). */
  peekType(e: A.Expr, scope: Scope): Type {
    if (e.k === "lambda") return DYN;
    return this.expr(e, scope);
  }

  pickOverload(bs: FnSig[], argc: number, firstT: Type | undefined): FnSig | undefined {
    const fits = bs.filter((b) => argc <= b.params.length && argc >= b.params.filter((p) => !p.hasDefault).length);
    if (!fits.length) return undefined;
    if (!firstT) return fits[0];
    return fits.find((b) => b.params.length && kindMatches(b.params[0].type, firstT));
  }

  callEntry(e: Extract<A.Expr, { k: "call" }>, entry: ValueEntry, scope: Scope, expected: Type | undefined, prefix: string): Type {
    switch (entry.k) {
      case "fn":
        e.resolved = { kind: "fn", pyName: prefix + entry.sig.pyName };
        return this.callSig(e, entry.sig, e.args, scope);
      case "record": {
        const info = entry.info;
        if (info.extern) { this.error(e, "E180", `extern type '${info.name}' can't be constructed directly`); return DYN; }
        e.resolved = { kind: "ctor", pyName: prefix + info.pyName, fields: info.fields.map((f) => pyAttr(f.name)) };
        const inst = this.instFromExpected(info, expected);
        const sig: FnSig = { name: info.name, pyName: info.pyName, tparams: [], params: info.fields.map((f) => ({ name: f.name, type: subst(f.type, inst), hasDefault: f.hasDefault, mutable: false })), ret: { k: "named", name: info.id, args: info.tparams.map((tp) => inst.get(tp.name)!) } };
        return this.callSig(e, sig, e.args, scope);
      }
      case "variant": {
        const vi = entry.info;
        if (!vi.hasParens) {
          this.error(e, "E111", `${vi.name} has no fields, so it isn't called`, `write just ${vi.name}`);
          return this.entryValue(entry, e.callee as any, expected, prefix);
        }
        e.resolved = { kind: "ctor", pyName: prefix + vi.pyName, fields: vi.fields.map((f) => pyAttr(f.name)) };
        const inst = this.instFromExpected(vi.sum, expected);
        const sig: FnSig = { name: vi.name, pyName: vi.pyName, tparams: [], params: vi.fields.map((f) => ({ name: f.name, type: subst(f.type, inst), hasDefault: f.hasDefault, mutable: false })), ret: { k: "named", name: vi.sum.id, args: vi.sum.tparams.map((tp) => inst.get(tp.name)!) } };
        return this.callSig(e, sig, e.args, scope);
      }
      case "global": case "const": {
        const t = entry.k === "global" ? entry.v.type : entry.type;
        if (entry.k === "global") (e.callee as any).ref = { kind: "var", pyName: prefix + entry.v.pyName };
        else (e.callee as any).ref = { kind: "const", py: entry.py };
        return this.callValue(e, t, scope);
      }
      case "module":
        this.error(e, "E180", `'${entry.alias}' is a module and can't be called`);
        return DYN;
    }
  }

  instFromExpected(info: RecordInfo | SumInfo, expected?: Type): Map<string, Type> {
    const inst = new Map(info.tparams.map((tp) => [tp.name, fresh(tp.constraint)] as [string, Type]));
    const pe = expected ? prune(expected) : undefined;
    const target = pe?.k === "opt" ? prune(pe.inner) : pe;
    if (target?.k === "named" && target.name === info.id) info.tparams.forEach((tp, i) => unify(inst.get(tp.name)!, target.args[i]));
    return inst;
  }

  callValue(e: Extract<A.Expr, { k: "call" }>, ft: Type, scope: Scope): Type {
    const pt = prune(ft);
    e.resolved = e.resolved ?? { kind: "value" };
    if (pt.k === "dyn") { e.args.forEach((a) => this.expr(a.value, scope)); e.resolved = { kind: "dyn" }; return DYN; }
    if (pt.k !== "fn") {
      this.error(e.callee, "E180", `'${exprText(e.callee)}' is ${show(ft)}, not a function`);
      e.args.forEach((a) => this.expr(a.value, scope));
      return DYN;
    }
    const need = pt.minArgs ?? pt.params.length;
    if (e.args.length < need || e.args.length > pt.params.length) {
      this.error(e, "E111", `'${exprText(e.callee)}' takes ${need === pt.params.length ? need : `${need} to ${pt.params.length}`} argument(s), but ${e.args.length} were given`);
    }
    e.args.forEach((a, i) => {
      if (a.name) this.error(a.value, "E113", "named arguments can't be used when calling a function value");
      const pty = pt.params[i];
      const t = this.expr(a.value, scope, pty);
      if (pty) this.expectType(t, pty, a.value, `argument ${i + 1}`);
    });
    return pt.ret;
  }

  /** Bind arguments to a signature's parameters and check them. Returns the call's result type. */
  callSig(e: Extract<A.Expr, { k: "call" }>, sig: FnSig, args: A.Arg[], scope: Scope, preInst?: Map<string, Type>, recv = false): Type {
    this.ensureInferred(sig, e);
    const inst = new Map<string, Type>(preInst ?? []);
    for (const tp of sig.tparams) if (!inst.has(tp.name)) inst.set(tp.name, fresh(tp.constraint));
    const params = sig.params.map((p) => ({ ...p, type: subst(p.type, inst) }));
    const bound: (A.Arg | undefined)[] = new Array(params.length).fill(undefined);
    let pos = 0;
    const display = recv ? `.${sig.name}()` : `${sig.name}()`;
    for (const a of args) {
      if (a.name) {
        const idx = params.findIndex((p) => p.name === a.name);
        if (idx < 0) {
          const sugg = closest(a.name, params.map((p) => p.name));
          this.error(a.value, "E113", `${display} has no parameter named '${a.name}'`, sugg ? `did you mean '${sugg}'?` : `parameters: ${params.map((p) => p.name).join(", ") || "(none)"}`);
          this.expr(a.value, scope);
          continue;
        }
        if (bound[idx]) this.error(a.value, "E113", `argument '${a.name}' is given twice`);
        bound[idx] = a;
      } else {
        if (pos >= params.length) {
          const shown = recv ? params.length - 1 : params.length;
          const given = recv ? args.length - 1 : args.length;
          this.error(a.value, "E111", `${display} takes ${shown} argument(s), but ${given} were given`, `signature: ${sigText(sig, recv)}`);
          this.expr(a.value, scope);
          continue;
        }
        bound[pos++] = a;
      }
    }
    params.forEach((p, i) => {
      const a = bound[i];
      if (!a) {
        if (!p.hasDefault) this.error(e, "E112", `missing argument '${p.name}' (${show(p.type)}) for ${display}`, `signature: ${sigText(sig, recv)}`);
        return;
      }
      const t = this.expr(a.value, scope, p.type);
      this.expectType(t, p.type, a.value, `argument '${p.name}' of ${display}`);
      if (p.mutable) this.requireMutablePlace(a.value, scope, recv && i === 0 ? "modify" : `pass it to 'var' parameter '${p.name}' of ${display}`, a.value);
    });
    (e as any).boundArgs = bound;
    return subst(sig.ret, inst);
  }

  callBuiltin(e: Extract<A.Expr, { k: "call" }>, sig: FnSig, args: A.Arg[], scope: Scope, recv: boolean): Type {
    if (sig.variadic) {
      for (const a of args) {
        if (a.name) this.error(a.value, "E113", `print() doesn't take named arguments`);
        const t = this.expr(a.value, scope);
        if (prune(t).k === "unit") this.error(a.value, "E110", "this expression has no value to print");
      }
      e.resolved = { kind: "builtin", builtin: sig.builtin!, args: args.map((a) => a.value), print: true };
      return UNIT;
    }
    const t = this.callSig(e, sig, args, scope, undefined, recv);
    const bound: (A.Arg | undefined)[] = (e as any).boundArgs;
    const final = sig.params.map((p, i) => bound[i]?.value ?? p.default!);
    e.resolved = { kind: "builtin", builtin: sig.builtin!, args: final };
    // constraint check for generic parameters (e.g. sum() needs numbers)
    return t;
  }
}

// ---------------------------------------------------------------------------------------------
// helpers

export const globalTypeRegistry = new Map<string, TypeInfo>();

const COMPARE_OPS = new Set(["<", "<=", ">", ">="]);

function pos(e: A.Pos): A.Pos { return { line: e.line, col: e.col, end: e.end }; }

export function pyModulePath(mod: string): string { return mod + "_tsa"; }

function irrefutable(p: A.Pattern): boolean {
  switch (p.k) {
    case "pwild": return true;
    case "pbind": return !/^[A-Z]/.test(p.name);
    case "ptuple": return p.els.every(irrefutable);
    case "por": return p.alts.some(irrefutable);
    default: return false;
  }
}

function bindsNames(p: A.Pattern): boolean {
  switch (p.k) {
    case "pbind": return true;
    case "ptuple": return p.els.some(bindsNames);
    case "pctor": return p.args.some(bindsNames);
    case "psome": case "pok": case "perr": return bindsNames(p.inner);
    case "por": return p.alts.some(bindsNames);
    default: return false;
  }
}

/** Does a builtin's first parameter type accept a value of kind `t`? (overload selection) */
function kindMatches(param: Type, t: Type): boolean {
  const p = prune(param), a = prune(t);
  if (a.k === "dyn" || a.k === "var" || a.k === "never") return true;
  if (p.k === "param") {
    if (!p.constraint) return true;
    return satisfies(a, p.constraint);
  }
  if (p.k === "dyn") return true;
  if (p.k === "float") return a.k === "float" || a.k === "int";
  if (p.k === "list" && a.k === "list") {
    const pe = prune(p.el);
    if (pe.k === "list") return prune(a.el).k === "list" || prune(a.el).k === "var";
    if (pe.k === "str" || pe.k === "bool") return assignQuiet(a.el, pe);
    return true;
  }
  return p.k === a.k;
}

/** assign() without leaving variable bindings behind. */
function assignQuiet(actual: Type, expected: Type): boolean {
  const snapshot = collectVars(actual).concat(collectVars(expected)).map((v) => [v, v.ref, v.constraint] as const);
  const ok = assign(actual, expected);
  for (const [v, ref, c] of snapshot) { v.ref = ref; v.constraint = c; }
  return ok;
}

function collectVars(t: Type, out: (Type & { k: "var" })[] = []): (Type & { k: "var" })[] {
  switch (t.k) {
    case "var": out.push(t); if (t.ref) collectVars(t.ref, out); break;
    case "list": case "set": collectVars(t.el, out); break;
    case "map": collectVars(t.key, out); collectVars(t.val, out); break;
    case "tuple": t.els.forEach((e) => collectVars(e, out)); break;
    case "opt": collectVars(t.inner, out); break;
    case "res": collectVars(t.ok, out); collectVars(t.err, out); break;
    case "fn": t.params.forEach((p) => collectVars(p, out)); collectVars(t.ret, out); break;
    case "named": t.args.forEach((a) => collectVars(a, out)); break;
  }
  return out;
}

function instFirst(sig: FnSig): Type {
  const inst = new Map(sig.tparams.map((tp) => [tp.name, fresh(tp.constraint)] as [string, Type]));
  return subst(sig.params[0].type, inst);
}

function sigText(s: FnSig, recv = false): string {
  const ps = s.params.slice(recv ? 1 : 0).map((p) => `${p.mutable ? "var " : ""}${p.name}: ${show(p.type)}${p.hasDefault ? " = ..." : ""}`);
  const head = recv && s.params[0] ? `${show(s.params[0].type)}.${s.name}` : s.name;
  return `${head}(${ps.join(", ")})${prune(s.ret).k === "unit" ? "" : " -> " + show(s.ret)}`;
}

/** Short source-like rendering of an expression, for hints. */
export function exprText(e: A.Expr): string {
  switch (e.k) {
    case "int": case "float": return e.value;
    case "bool": return String(e.value);
    case "none": return "none";
    case "str": return '"' + e.parts.map((p) => (typeof p === "string" ? p : `{${exprText(p)}}`)).join("") + '"';
    case "name": return e.name;
    case "member": return `${exprText(e.obj)}.${e.name}`;
    case "index": return `${exprText(e.obj)}[${exprText(e.index)}]`;
    case "call": return `${exprText(e.callee)}(${e.args.map((a) => (a.name ? `${a.name}=` : "") + exprText(a.value)).join(", ")})`;
    case "binary": return `${exprText(e.left)} ${e.op} ${exprText(e.right)}`;
    case "unary": return e.op === "not" ? `not ${exprText(e.expr)}` : `-${exprText(e.expr)}`;
    case "list": return `[${e.items.map(exprText).join(", ")}]`;
    case "tuple": return `(${e.items.map(exprText).join(", ")})`;
    case "try": return `${exprText(e.expr)}?`;
    case "unwrap": return `${exprText(e.expr)}!`;
    case "slice": return `${exprText(e.obj)}[${e.lo ? exprText(e.lo) : ""}:${e.hi ? exprText(e.hi) : ""}]`;
    default: return "...";
  }
}
