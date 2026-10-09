// Tersa type representation, unification and assignability.

export type Type =
  | { k: "int" } | { k: "float" } | { k: "str" } | { k: "bool" } | { k: "unit" } | { k: "dyn" } | { k: "never" }
  | { k: "list"; el: Type }
  | { k: "map"; key: Type; val: Type }
  | { k: "set"; el: Type }
  | { k: "tuple"; els: Type[] }
  | { k: "opt"; inner: Type }
  | { k: "res"; ok: Type; err: Type }
  | { k: "fn"; params: Type[]; ret: Type; minArgs?: number }
  | { k: "named"; name: string; args: Type[] }
  | { k: "var"; id: number; ref?: Type; constraint?: string }
  | { k: "param"; name: string; constraint?: string };

export const INT: Type = { k: "int" };
export const FLOAT: Type = { k: "float" };
export const STR: Type = { k: "str" };
export const BOOL: Type = { k: "bool" };
export const UNIT: Type = { k: "unit" };
export const DYN: Type = { k: "dyn" };
export const NEVER: Type = { k: "never" };
export const list = (el: Type): Type => ({ k: "list", el });
export const map = (key: Type, val: Type): Type => ({ k: "map", key, val });
export const opt = (inner: Type): Type => ({ k: "opt", inner });
export const res = (ok: Type, err: Type): Type => ({ k: "res", ok, err });
export const tuple = (els: Type[]): Type => (els.length === 0 ? UNIT : { k: "tuple", els });
export const fnType = (params: Type[], ret: Type, minArgs?: number): Type => ({ k: "fn", params, ret, minArgs });

let nextVar = 1;
export function fresh(constraint?: string): Type { return { k: "var", id: nextVar++, constraint }; }

export function prune(t: Type): Type {
  while (t.k === "var" && t.ref) t = t.ref;
  return t;
}

/** Fully resolve a type (replace bound vars everywhere). */
export function resolve(t: Type): Type {
  t = prune(t);
  switch (t.k) {
    case "list": return { k: "list", el: resolve(t.el) };
    case "set": return { k: "set", el: resolve(t.el) };
    case "map": return { k: "map", key: resolve(t.key), val: resolve(t.val) };
    case "tuple": return { k: "tuple", els: t.els.map(resolve) };
    case "opt": return { k: "opt", inner: resolve(t.inner) };
    case "res": return { k: "res", ok: resolve(t.ok), err: resolve(t.err) };
    case "fn": return { k: "fn", params: t.params.map(resolve), ret: resolve(t.ret), minArgs: t.minArgs };
    case "named": return { k: "named", name: t.name, args: t.args.map(resolve) };
    default: return t;
  }
}

export function show(t: Type): string {
  const names = new Map<number, string>();
  const go = (t: Type): string => {
    t = prune(t);
    switch (t.k) {
      case "int": case "float": case "str": case "bool": case "dyn": case "never": return t.k;
      case "unit": return "()";
      case "list": return `[${go(t.el)}]`;
      case "set": return `set[${go(t.el)}]`;
      case "map": return `{${go(t.key)}: ${go(t.val)}}`;
      case "tuple": return `(${t.els.map(go).join(", ")})`;
      case "opt": { const s = go(t.inner); return t.inner.k === "fn" || prune(t.inner).k === "res" ? `(${s})?` : `${s}?`; }
      case "res": return `${go(t.ok)}!${go(t.err)}`;
      case "fn": return `fn(${t.params.map(go).join(", ")}) -> ${go(t.ret)}`;
      case "named": return t.args.length ? `${t.name}[${t.args.map(go).join(", ")}]` : t.name;
      case "param": return t.name;
      case "var": {
        if (!names.has(t.id)) names.set(t.id, "T" + (names.size ? names.size : ""));
        return names.get(t.id)!;
      }
    }
  };
  return go(t);
}

function occurs(v: Type & { k: "var" }, t: Type): boolean {
  t = prune(t);
  if (t === v) return true;
  switch (t.k) {
    case "list": case "set": return occurs(v, t.el);
    case "map": return occurs(v, t.key) || occurs(v, t.val);
    case "tuple": return t.els.some((e) => occurs(v, e));
    case "opt": return occurs(v, t.inner);
    case "res": return occurs(v, t.ok) || occurs(v, t.err);
    case "fn": return t.params.some((p) => occurs(v, p)) || occurs(v, t.ret);
    case "named": return t.args.some((a) => occurs(v, a));
    default: return false;
  }
}

/** Does a concrete type satisfy a constraint class? */
export function satisfies(t: Type, c: string): boolean {
  t = prune(t);
  if (t.k === "dyn" || t.k === "never") return true;
  if (t.k === "var") return true; // checked when bound
  if (t.k === "param") return t.constraint === c || (c === "ord" && t.constraint === "num") || c === "eq";
  switch (c) {
    case "num": return t.k === "int" || t.k === "float";
    case "ord": return t.k === "int" || t.k === "float" || t.k === "str" || t.k === "bool" ||
      (t.k === "tuple" && t.els.every((e) => satisfies(e, "ord"))) || (t.k === "list" && satisfies(t.el, "ord"));
    case "sized": return t.k === "str" || t.k === "list" || t.k === "map" || t.k === "set" || t.k === "tuple";
    case "hash": return isHashable(t);
    case "eq": return t.k !== "fn";
    default: return true;
  }
}

/** Records with mutable fields and lists/maps/sets cannot be map keys or set elements. */
export let hashableNamed: (name: string) => boolean = () => true;
export function setHashableNamed(f: (name: string) => boolean) { hashableNamed = f; }
export function isHashable(t: Type): boolean {
  t = prune(t);
  switch (t.k) {
    case "list": case "map": case "set": case "fn": return false;
    case "tuple": return t.els.every(isHashable);
    case "opt": return isHashable(t.inner);
    case "named": return hashableNamed(t.name) && t.args.every(isHashable);
    default: return true;
  }
}

function bindVar(v: Type & { k: "var" }, t: Type): boolean {
  t = prune(t);
  if (t === v) return true;
  if (occurs(v, t)) return false;
  if (v.constraint) {
    if (t.k === "var") {
      // merge constraints; "num" is the strictest of the common ones
      if (!t.constraint || v.constraint === "num") t.constraint = v.constraint;
    } else if (!satisfies(t, v.constraint)) return false;
  }
  v.ref = t;
  return true;
}

/** Exact structural unification (binds type variables). */
export function unify(a: Type, b: Type): boolean {
  a = prune(a); b = prune(b);
  if (a === b) return true;
  if (a.k === "var") return bindVar(a, b);
  if (b.k === "var") return bindVar(b, a);
  if (a.k === "dyn" || b.k === "dyn") return true;
  if (a.k === "never" || b.k === "never") return true;
  if (a.k !== b.k) return false;
  switch (a.k) {
    case "list": case "set": return unify(a.el, (b as typeof a).el);
    case "map": { const bb = b as typeof a; return unify(a.key, bb.key) && unify(a.val, bb.val); }
    case "tuple": { const bb = b as typeof a; return a.els.length === bb.els.length && a.els.every((e, i) => unify(e, bb.els[i])); }
    case "opt": return unify(a.inner, (b as typeof a).inner);
    case "res": { const bb = b as typeof a; return unify(a.ok, bb.ok) && unify(a.err, bb.err); }
    case "fn": {
      const bb = b as typeof a;
      return a.params.length === bb.params.length && a.params.every((p, i) => unify(p, bb.params[i])) && unify(a.ret, bb.ret);
    }
    case "named": { const bb = b as typeof a; return a.name === bb.name && a.args.length === bb.args.length && a.args.every((x, i) => unify(x, bb.args[i])); }
    case "param": return a.name === (b as typeof a).name;
    default: return true;
  }
}

/**
 * Can a value of type `actual` be used where `expected` is required?
 * Allows: int -> float, T -> T? (implicit some), never -> anything, dyn <-> anything.
 */
export function assign(actual: Type, expected: Type): boolean {
  const a = prune(actual);
  const e = prune(expected);
  if (a === e) return true;
  if (e.k === "dyn" || a.k === "dyn" || a.k === "never") return true;
  if (e.k === "var") {
    // binding an unknown expectation to the actual type
    return bindVar(e, a);
  }
  if (a.k === "var") {
    if (e.k === "opt") return bindVar(a, e);
    return bindVar(a, e);
  }
  if (e.k === "float" && a.k === "int") return true;
  if (e.k === "opt") {
    if (a.k === "opt") return assign(a.inner, e.inner);
    return assign(a, e.inner);
  }
  if (a.k !== e.k) return false;
  switch (a.k) {
    case "list": case "set": return assign(a.el, (e as typeof a).el);
    case "map": { const ee = e as typeof a; return unify(a.key, ee.key) && assign(a.val, ee.val); }
    case "tuple": { const ee = e as typeof a; return a.els.length === ee.els.length && a.els.every((x, i) => assign(x, ee.els[i])); }
    case "res": { const ee = e as typeof a; return assign(a.ok, ee.ok) && assign(a.err, ee.err); }
    case "fn": {
      const ee = e as typeof a;
      if (a.params.length < ee.params.length) {
        // a function taking fewer params can't be called with more args... except it can't. Reject.
        return false;
      }
      const need = a.minArgs ?? a.params.length;
      if (ee.params.length < need) return false;
      for (let i = 0; i < ee.params.length; i++) if (!assign(ee.params[i], a.params[i])) return false;
      return prune(ee.ret).k === "unit" ? true : assign(a.ret, ee.ret);
    }
    case "named": { const ee = e as typeof a; return a.name === ee.name && a.args.length === ee.args.length && a.args.every((x, i) => unify(x, ee.args[i])); }
    case "param": return a.name === (e as typeof a).name;
    default: return true;
  }
}

/** Replace generic parameters by name. */
export function subst(t: Type, m: Map<string, Type>): Type {
  switch (t.k) {
    case "param": return m.get(t.name) ?? t;
    case "var": return t.ref ? subst(t.ref, m) : t;
    case "list": return { k: "list", el: subst(t.el, m) };
    case "set": return { k: "set", el: subst(t.el, m) };
    case "map": return { k: "map", key: subst(t.key, m), val: subst(t.val, m) };
    case "tuple": return { k: "tuple", els: t.els.map((e) => subst(e, m)) };
    case "opt": return { k: "opt", inner: subst(t.inner, m) };
    case "res": return { k: "res", ok: subst(t.ok, m), err: subst(t.err, m) };
    case "fn": return { k: "fn", params: t.params.map((p) => subst(p, m)), ret: subst(t.ret, m), minArgs: t.minArgs };
    case "named": return { k: "named", name: t.name, args: t.args.map((a) => subst(a, m)) };
    default: return t;
  }
}

/** Is the type (after resolution) still containing unbound variables? */
export function hasVars(t: Type): boolean {
  t = prune(t);
  switch (t.k) {
    case "var": return true;
    case "list": case "set": return hasVars(t.el);
    case "map": return hasVars(t.key) || hasVars(t.val);
    case "tuple": return t.els.some(hasVars);
    case "opt": return hasVars(t.inner);
    case "res": return hasVars(t.ok) || hasVars(t.err);
    case "fn": return t.params.some(hasVars) || hasVars(t.ret);
    case "named": return t.args.some(hasVars);
    default: return false;
  }
}
