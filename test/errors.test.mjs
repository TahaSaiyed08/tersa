// Each case is a mistake LLMs commonly make. Tersa must reject it at compile time with the right code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSource } from "./helpers.mjs";

const cases = [
  ["none dereference", `fn f() -> str? = none\nprint(f().upper())`, "E140"],
  ["optional used as value", `fn f() -> int? = none\nx: int = f()`, "E140"],
  ["optional in arithmetic", `m = {"a": 1}\nx = m.get("a") + 1`, "E140"],
  ["optional field access", `type P(x: int)\nfn f() -> P? = none\nprint(f().x)`, "E140"],
  ["comparing non-optional to none", `x = 5\nif x == none: print("?")`, "E140"],
  ["str + int", `age = 3\nmsg = "age " + age`, "E110"],
  ["truthiness of list", `xs = [1]\nif xs: print("y")`, "E170"],
  ["truthiness of int", `n = 1\nwhile n: n = 0`, "E170"],
  ["reassign immutable", `total = 0\ntotal = 1`, "E120"],
  ["compound assign immutable", `total = 0\nfor i in 0..3:\n    total += i`, "E120"],
  ["mutate immutable list", `xs = [1]\nxs.push(2)`, "E121"],
  ["index-assign immutable", `xs = [1]\nxs[0] = 2`, "E121"],
  ["mutate immutable field", `type P(x: int)\np = P(1)\np.x = 2`, "E121"],
  ["mutate param without var", `fn f(xs: [int]) = xs.push(1)`, "E121"],
  ["discarded sort result", `xs = [3, 1]\nxs.sort()`, "E141"],
  ["discarded string method result", `s = " a "\ns.trim()`, "E141"],
  ["ignored Result", `write_file("x", "y")`, "E141"],
  ["Result used as value", `fn f() -> int!str = ok(1)\nx: int = f()`, "E141"],
  ["non-exhaustive match", `type S = A | B | C\nfn f(s: S) -> int:\n    match s:\n        A: 1\n        B: 2`, "E130"],
  ["non-exhaustive option match", `fn f(x: int?) -> int:\n    match x:\n        some(v): v`, "E130"],
  ["non-exhaustive int match", `fn f(x: int) -> int:\n    match x:\n        1: 1`, "E130"],
  ["unreachable arm", `fn f(x: int) -> int:\n    match x:\n        _: 0\n        1: 1`, "E131"],
  ["missing return", `fn f(x: int) -> int:\n    if x > 0:\n        return 1`, "E150"],
  ["return value from unit fn", `fn f() -> ():\n    return 1`, "E150"],
  ["recursive fn without return type", `fn f(n: int) = if n == 0: 0 else: f(n - 1)`, "E150"],
  ["some paths return a value", `fn f(n: int):\n    if n > 0:\n        return 1\n    print("x")`, "E150"],
  ["if expression without else", `x = 1\ny: int = if x > 0: 1`, "E150"],
  ["unknown name", `print(totl)`, "E100"],
  ["unknown method", `"abc".toUpperCase()`, "E102"],
  ["unknown field", `type P(x: int)\nprint(P(1).y)`, "E102"],
  ["wrong arg count", `fn f(a: int) -> int = a\nf(1, 2)`, "E111"],
  ["missing arg", `fn f(a: int, b: int) -> int = a\nf(1)`, "E112"],
  ["unknown named arg", `fn f(a: int) -> int = a\nf(b=1)`, "E113"],
  ["wrong arg type", `fn f(a: int) -> int = a\nf("1")`, "E110"],
  ["int() on string", `n = int("5")`, "E110"],
  ["wrong return type", `fn f() -> int = "x"`, "E110"],
  ["? outside function", `fn f() -> int? = none\nx = f()?`, "E160"],
  ["? in non-optional function", `fn f() -> int? = none\nfn g() -> int:\n    f()?`, "E160"],
  ["mismatched error type with ?", `fn f() -> int!int = ok(1)\nfn g() -> int!str:\n    ok(f()?)`, "E160"],
  ["duplicate declaration", `fn f():\n    x = 1\n    x = 2`, "E120"],
  ["redeclare in nested block", `fn f():\n    x = 1\n    if true:\n        x = 2`, "E120"],
  ["list as map key", `m: {[int]: int} = {}`, "E180"],
  ["nested optional", `x: int?? = none`, "E180"],
  ["break outside loop", `break`, "E150"],
  ["mixed list types", `xs = [1, "a"]`, "E110"],
  ["unknown type", `x: string = "a"`, "E101"],
  ["generic constraint", `print(sum(["a", "b"]))`, "E110"],
  ["variant arity", `type S = A(x: int) | B\nfn f(s: S) -> int:\n    match s:\n        A(x, y): x\n        B: 0`, "E111"],
  ["field on choice type", `type S = A(x: int) | B(x: int, y: int)\nfn f(s: S) -> int = s.y`, "E102"],
  ["var used before declared in sibling branch", `fn f(c: bool) -> int:\n    if c:\n        y = 1\n    else:\n        y = 2\n    y`, "E100"],
  ["lambda returning wrong type", `xs = [1, 2]\nys: [str] = xs.map(x => x * 2)`, "E110"],
  ["calling a non-function", `x = 1\nx(2)`, "E180"],
  ["comparison result unused", `x = 1\nx == 2`, "E141"],
];

for (const [name, src, code] of cases) {
  test(`rejects: ${name}`, () => {
    const res = checkSource(src);
    const codes = res.diags.filter((d) => (d.severity ?? "error") === "error").map((d) => d.code);
    assert.ok(codes.includes(code), `expected ${code}, got [${codes.join(", ")}]\n${res.diags.map((d) => d.message).join("\n")}`);
  });
}

// Every error should come with a fix hint for the most common mistakes.
test("common mistakes include a fix hint", () => {
  for (const [name, src] of cases.slice(0, 20)) {
    const res = checkSource(src);
    const errs = res.diags.filter((d) => (d.severity ?? "error") === "error");
    assert.ok(errs.some((d) => d.hint), `no hint for: ${name} (${errs.map((d) => d.message).join("; ")})`);
  }
});

// Programs that look tricky but are valid must compile without errors.
const valid = [
  ["narrowing after early return", `fn f(x: int?) -> int:\n    if x == none: return 0\n    x + 1`],
  ["narrowing with and", `fn f(x: int?) -> bool = x != none and x > 3`],
  ["narrowing in if branch", `fn f(x: str?) -> str:\n    if x != none:\n        return x.upper()\n    "none"`],
  ["implicit some", `fn f(b: bool) -> int?:\n    if b: return 1\n    none`],
  ["shadowing a global inside a function", `x = 1\nfn f() -> int:\n    x = 2\n    x`],
  ["mutating a global var", `var n = 0\nfn bump():\n    n += 1\nbump()`],
  ["int where float expected", `fn f(x: float) -> float = x\nprint(f(2))`],
  ["empty list gets its type later", `var xs = []\nxs.push(1)\nprint(xs[0] + 1)`],
  ["sibling loop variables", `fn f():\n    for i in 0..2: print(i)\n    for i in 0..2: print(i)`],
  ["comprehension var shadows outer", `fn f() -> [int]:\n    x = 10\n    [x * 2 for x in [1, 2]]`],
  ["exhaustive bool match", `fn f(b: bool) -> int:\n    match b:\n        true: 1\n        false: 0`],
  ["exhaustive result match", `fn f(r: int!str) -> int:\n    match r:\n        ok(v): v\n        err(_): 0`],
  ["generic function", `fn id[T](x: T) -> T = x\nprint(id(1), id("a"))`],
  ["ignore a result on purpose", `_ = write_file("/nonexistent/x", "y")`],
  ["user fn via method syntax", `fn double(x: int) -> int = x * 2\nprint(3.double())`],
  ["builtin method beats same-named user fn", `fn first(id: int) -> str = "user"\nprint([1].first())`],
];

for (const [name, src] of valid) {
  test(`accepts: ${name}`, () => {
    const res = checkSource(src);
    const errs = res.diags.filter((d) => (d.severity ?? "error") === "error");
    assert.equal(errs.length, 0, errs.map((d) => `${d.code} ${d.message}`).join("\n"));
  });
}

test("warns about unused variables", () => {
  const res = checkSource(`fn f() -> int:\n    unused = 5\n    1`);
  assert.ok(res.diags.some((d) => d.code === "W200"));
});

test("--json diagnostics have exact positions", () => {
  const res = checkSource(`x = 1\ny = x + "a"`);
  const d = res.diags.find((d) => d.code === "E110");
  assert.equal(d.line, 2);
  assert.equal(d.col, 5);
});
