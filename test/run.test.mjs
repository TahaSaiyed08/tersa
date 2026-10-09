// End-to-end: compile to Python, run, and compare output.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { ROOT, runFile, runSource, tempDir } from "./helpers.mjs";

const exDir = path.join(ROOT, "examples");
for (const f of fs.readdirSync(exDir).filter((f) => f.endsWith(".tsa"))) {
  test(`example ${f} matches its expected output`, () => {
    const expected = fs.readFileSync(path.join(exDir, f.replace(/\.tsa$/, ".out")), "utf8");
    const r = runFile(path.join(exDir, f));
    assert.equal(r.stderr, "");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, expected);
  });
}

const programs = [
  ["string interpolation and show", `x = [1, 2]\nprint("x={x} n={none} b={true} s={"q"}")`, `x=[1, 2] n=none b=true s=q\n`],
  ["?? binds tighter than +", `m = {"a": 1}\nprint(m.get("b") ?? 0 + 1)`, `1\n`],
  ["closures capture loop values", `var fs: [fn() -> int] = []\nfor i in 0..3:\n    fs.push(() => i)\nprint([f() for f in fs])`, `[0, 1, 2]\n`],
  ["? propagates errors", `fn p(s: str) -> int!str:\n    n = s.parse_int()\n    if n == none: return err("bad")\n    ok(n)\nfn sum2(a: str, b: str) -> int!str = ok(p(a)? + p(b)?)\nprint(sum2("1", "2"), sum2("1", "x"))`, `ok(3) err("bad")\n`],
  ["? on optionals", `fn f(xs: [int]) -> int? = xs.first()? * 10\nprint(f([4]), f([]))`, `40 none\n`],
  ["match expression value", `fn f(n: int) -> str:\n    match n:\n        0: "zero"\n        x if x < 0: "neg"\n        _: "pos"\nprint(f(0), f(-1), f(5))`, `zero neg pos\n`],
  ["records are values", `type P(x: int, y: int)\nprint(P(1, 2) == P(1, 2), P(1, 2).with(y=5))`, `true P(x=1, y=5)\n`],
  ["var fields mutate in place", `type C(var n: int)\nc = C(0)\nfn inc(c: C): c.n += 1\ninc(c)\ninc(c)\nprint(c.n)`, `2\n`],
  ["inclusive and exclusive ranges", `print(0..3, [i for i in 1..=3])`, `[0, 1, 2] [1, 2, 3]\n`],
  ["int literal stored as float", `x: float = 2\nprint(x)`, `2.0\n`],
  ["methods on choice types", `type S = A | B(n: int)\nfn S.size() -> int:\n    match self:\n        A: 0\n        B(n): n\nprint(A.size(), B(3).size())`, `0 3\n`],
  ["block if as value", `x = 3\nlabel = if x > 2:\n    "big"\nelse:\n    "small"\nprint(label)`, `big\n`],
  ["unicode strings", `s = "héllo ✓"\nprint(s.upper(), len(s))`, `HÉLLO ✓ 7\n`],
  ["sets", `s = set([3, 1, 3])\nprint(len(s), 3 in s, s.to_list())`, `2 true [1, 3]\n`],
  ["python keywords as names", `lambda_ = 1\nclass_ = 2\nfn len2(list: [int]) -> int = len(list)\nprint(len2([1, 2]), lambda_ + class_)`, `2 3\n`],
  ["default args are not shared", `fn add(x: int, var acc: [int] = []) -> [int]:\n    acc.push(x)\n    acc\nprint(add(1), add(2))`, `[1] [2]\n`],
];

for (const [name, src, out] of programs) {
  test(`runs: ${name}`, () => {
    const r = runSource(src);
    assert.equal(r.stderr, "", r.stderr);
    assert.equal(r.stdout, out);
  });
}

test("runtime errors point at the .tsa line", () => {
  const r = runSource(`fn f(xs: [int]) -> int = xs[5]\nprint(f([1]))`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /panic: index out of range/);
  assert.match(r.stderr, /\.tsa:1 in f/);
  assert.match(r.stderr, /\.tsa:2/);
});

test("unwrapping none panics with a clear message", () => {
  const r = runSource(`x: int? = none\nprint(x!)`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unwrapped none/);
});

test("program arguments", () => {
  const r = runSource(`print(args())`, ["a", "b"]);
  assert.equal(r.stdout, `["a", "b"]\n`);
});

test("test blocks", () => {
  const r = runSource(`fn add(a: int, b: int) -> int = a + b\ntest "adds":\n    assert add(1, 2) == 3\ntest "fails":\n    assert add(1, 1) == 3, "math"`, [], "test");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✓ adds/);
  assert.match(r.stdout, /✗ fails/);
  assert.match(r.stdout, /assertion failed: add\(1, 1\) == 3 \(math\)/);
  assert.match(r.stdout, /1 passed, 1 failed/);
});

test("modules: use, selective use, qualified use", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "geo.tsa"), `type Shape = Sq(s: float) | Ci(r: float)\nfn area(x: Shape) -> float:\n    match x:\n        Sq(s): s * s\n        Ci(r): 3.0 * r * r\nfn _hidden() = print("no")\n`);
  fs.writeFileSync(path.join(dir, "util.tsa"), `fn twice(n: int) -> int = n * 2\n`);
  fs.writeFileSync(path.join(dir, "main.tsa"), `use lib.geo\nuse util as u\nprint(area(Sq(2.0)), u.twice(4))\nmatch Ci(1.0):\n    Sq(_): print("sq")\n    Ci(r): print("ci", r)\n`);
  const r = runFile(path.join(dir, "main.tsa"));
  assert.equal(r.stderr, "");
  assert.equal(r.stdout, "4.0 8\nci 1.0\n");
  fs.writeFileSync(path.join(dir, "bad.tsa"), `use lib.geo: _hidden\n`);
  assert.equal(runFile(path.join(dir, "bad.tsa")).status, 1);
});

test("extern Python modules", () => {
  const r = runSource(`extern "math":\n    fn gcd(a: int, b: int) -> int\n    tau: float\nprint(gcd(12, 18), round(tau, 2))`);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout, "6 6.28\n");
});

test("json and dyn", () => {
  const r = runSource(`d = parse_json(r"""{"a": [1, 2], "b": "x"}""")!\nprint(len(d["a"] as [int]), d["b"] as str)\nprint(to_json({"k": [true, none]}))`);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout, `2 x\n{"k": [true, null]}\n`);
});

test("check --json output", () => {
  const dir = tempDir();
  const f = path.join(dir, "e.tsa");
  fs.writeFileSync(f, `x = "a" + 1\n`);
  const r = runFile(f, ["--json"], "check");
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.equal(j.diagnostics[0].code, "E110");
  assert.ok(j.diagnostics[0].hint);
});
