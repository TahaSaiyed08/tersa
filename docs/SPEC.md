# Tersa language reference (v0.1)

This is the full reference. For a compact version to paste into an LLM prompt, see [`llms.txt`](../llms.txt) (`tersa spec` prints it). The standard library is listed in [`STDLIB.md`](STDLIB.md).

## 1. Design goals

1. **Few tokens.** Python-shaped syntax (which LLMs already know well), implicit returns, inferred types for locals and return values, expression-oriented `if`/`match`, concise choice types.
2. **Few AI bugs.** Static types, no `null` (optional types instead), no exceptions for expected failures (result types instead), exhaustive `match`, explicit mutability, no truthiness. Every error comes with a concrete fix.
3. **Runs everywhere Python runs.** Tersa compiles to readable Python 3.10+ and can call any Python library through typed `extern` declarations.

## 2. Lexical structure

- Source files are UTF-8 with the `.tsa` extension.
- Blocks are formed by indentation after `:` (spaces only; tabs are an error). Inside `()`, `[]`, `{}` newlines are ignored. A trailing `\` continues a line.
- Comments start with `#`.
- Identifiers: `[A-Za-z_][A-Za-z0-9_]*`. Type and variant names start with an uppercase letter. Names starting with `_ts_` are reserved.
- Keywords: `fn var type if elif else match for in while break continue return true false none and or not test assert use extern as pass`.
- Numbers: `42`, `1_000_000`, `0xff`, `0b101`, `3.14`, `1e-9`.
- Strings: `"..."` with escapes `\n \t \r \\ \" \0 \u{1F600}` and interpolation `{expr}` or `{expr:spec}` (Python format specs, e.g. `{x:.2f}`, `{n:>5}`, `{p:.1%}`). `{{` and `}}` are literal braces. `"""..."""` spans lines. Raw strings `r"..."` / `r"""..."""` have no escapes and no interpolation (useful for JSON and regexes).

## 3. Types

| Type | Written | Values |
|---|---|---|
| Integer | `int` | `42` |
| Float | `float` | `3.14` (an `int` is accepted where a `float` is expected) |
| String | `str` | `"text"` (immutable) |
| Boolean | `bool` | `true`, `false` |
| Unit | `()` | the result of functions that return nothing |
| List | `[T]` | `[1, 2, 3]` |
| Map | `{K: V}` | `{"a": 1}` (keys must be hashable) |
| Set | `set[T]` | `set([1, 2])` |
| Tuple | `(A, B)` | `(1, "x")`, accessed with `t.0` or `t[0]` |
| Optional | `T?` | a `T`, or `none` |
| Result | `T!E` | `ok(value)` or `err(error)`; `!E` is short for `()!E` |
| Function | `fn(A, B) -> R` | named functions and lambdas |
| Record | `Name` / `Name[T]` | declared with `type Name(...)` |
| Choice | `Name` / `Name[T]` | declared with `type Name = A | B(...)` |
| Dynamic | `dyn` | unchecked values from JSON or Python; convert with `as` |
| Never | `never` | the result of `panic`, `exit` |

Type inference: local variables, lambda parameters (from context), and function return types are inferred. Function parameters must be annotated. Empty literals (`[]`, `{}`) get their element type from later use.

Hashable types (usable as map keys and set elements): `int`, `float`, `str`, `bool`, tuples and optionals of hashable types, choice types, and records without `var` fields.

Type aliases: `type Grid = [[int]]`, `type Pair[T] = (T, T)`.

## 4. Variables and mutability

```
x = 5              # declares an immutable variable
var n = 0          # declares a mutable variable
n = n + 1          # reassigning requires var
y: float = 2       # annotated declaration (stores 2.0)
a, b = (1, 2)      # unpacking (tuples or lists)
_ = f()            # explicitly discard a value
```

Rules:
- A name may be declared only once per function (this matches Python's function-level scoping and prevents accidental shadowing). Different functions may reuse names; assigning a name that refers to an immutable variable of an *outer* function or the top level creates a new local.
- Variables are block-scoped: a variable declared inside an `if` branch is not visible after the `if`. To compute a value in branches, use `x = if c: a else: b` or declare `var x` before.
- **Mutation requires `var`.** This covers reassignment, compound assignment (`+=`), index assignment (`xs[i] = v`), field assignment (`p.f = v`, which also requires the field to be declared `var`), and mutating built-ins (`push`, `pop`, `insert`, `remove`, `extend`, `clear`, `add`).
- Loop variables and pattern bindings are immutable.
- Closures capture the *value* of immutable loop variables (unlike Python's late binding).

## 5. Functions

```
fn add(a: int, b: int) -> int:
    a + b                                 # the last expression is the result
fn sq(x: float) = x * x                   # one-line body; return type inferred
fn greet(name: str, punct: str = "!"):    # default parameter values
    print("hi {name}{punct}")
fn fill(var xs: [int], n: int):           # `var` parameter: may mutate the caller's list
    for i in 0..n: xs.push(i)
fn first[T](xs: [T]) -> T? = xs.first()   # generic
fn biggest[T: ord](xs: [T]) -> T = xs.max()
```

- The return type may be omitted; it is inferred from `return` statements and the final expression. Recursive functions (and functions used before their body can be inferred in a cycle) must declare it.
- A function returning `()!E` (written `!E`) that reaches the end of its body returns `ok(())`.
- Default values are evaluated on each call (no shared mutable defaults).
- Calls accept positional then named arguments: `greet("a", punct="?")`.
- Generic constraints: `num` (int or float), `ord` (comparable: numbers, str, bool, and tuples/lists of them), `hash` (hashable), `eq`.
- Lambdas: `x => x + 1`, `(a, b) => a + b`, `(x: int) => x`, `() => 0`. A lambda body is one expression (use an inline `if` or a named function for more).
- Functions can be nested; nested functions can read outer variables and assign outer `var`s.

**Method-call syntax.** `x.f(args)` resolves to, in order: a method declared on `x`'s type, a built-in function whose first parameter accepts `x`, then a user function whose first parameter accepts `x`. So `xs.map(f).filter(g).sum()` and `3.double()` both work.

**Methods** are declared on records and choice types with `fn Type.name(...)`; `self` is implicit:

```
type Point(x: float, y: float)
fn Point.norm() = sqrt(self.x ** 2 + self.y ** 2)
```

## 6. Records and choice types

```
type Point(x: float, y: float = 0.0)          # immutable record
type Counter(name: str, var count: int = 0)    # `var` field can change
type Shape = Circle(r: float) | Rect(w: float, h: float) | Empty
type Tree[T] =
    | Leaf
    | Node(left: Tree[T], value: T, right: Tree[T])
```

- Construct with positional or named arguments: `Point(1.0, y=2.0)`. Variants without fields are used bare: `Empty`.
- Records compare by value (`==`) and print as `Point(x=1.0, y=2.0)`.
- `p.with(x=5.0)` returns a copy with some fields changed.
- Fields of a choice type are reached through `match` (the compiler explains this if you try `shape.r`).
- Fields with defaults must come after fields without.

## 7. Control flow

```
if x > 0: print("pos")
elif x < 0: print("neg")
else: print("zero")

kind = if x > 0: "pos" else: "other"     # if as an expression needs an else

for i in 0..10: ...          # 0 to 9; 0..=10 includes 10; ranges also work as list values
for i, x in xs.enumerate(): ...
for k, v in m.items(): ...   # iterating a map directly gives its keys
while cond: ...              # break, continue
pass                         # empty block
```

Conditions must have type `bool`. There is no truthiness: write `len(xs) > 0`, `x != none`, `n != 0`.

Operators, from loosest to tightest:

| Operators | Notes |
|---|---|
| `or` | |
| `and` | |
| `not` | |
| `== != < <= > >= in not in` | `a < b < c` chains |
| `.. ..=` | ranges |
| `+ -` | `+` also joins strings and lists |
| `* / // %` | `/` always gives a float; `//` and `%` floor like Python; `str * int` repeats |
| `??` | default for optionals/results; binds tighter than arithmetic |
| unary `-` | |
| `**` | right-associative |
| postfix `() [] . ? ! as` | call, index/slice, member, try, unwrap, cast |

## 8. Pattern matching

```
match value:
    0: "zero"
    1 | 2 | 3: "small"
    n if n < 0: "negative"
    _: "large"
```

Patterns: literals (`1`, `-1`, `"a"`, `true`), `_`, a lowercase name (binds), `Variant`, `Variant(p1, p2)`, `Record(p1, p2)`, tuples `(p1, p2)`, `none`, `some(p)`, `ok(p)`, `err(p)`, alternatives `p1 | p2` (without bindings), and module-qualified constructors `geo.Circle(r)`. An arm may have a guard: `pattern if cond:`.

`match` must be exhaustive. The compiler lists the missing cases (`missing Voucher(_)`, `missing none`, ...) and rejects arms that can never run. For types with infinitely many values (int, str, ...) a `_` arm is required. `match` can be used as a statement or as a value.

## 9. Optionals and results

```
fn find(id: int) -> str?:
    if id == 1: return "alice"    # a T is automatically a T?
    none

name = find(2)
if name != none: print(name.upper())     # narrowed to str in this block
if name == none: return                  # narrowed for the rest of the block
label = find(2) ?? "anon"                # default
sure = find(1)!                          # unwrap or panic
```

Narrowing works with `!= none` / `== none` checks on variables, including in `and`/`or`, `not`, `while` conditions, and after an early `return`/`break`/`continue`/`panic`.

```
fn parse(s: str) -> int!str:
    n = s.parse_int()
    if n == none: return err("not a number: {s}")
    ok(n)

fn sum_all(xs: [str]) -> int!str:
    var total = 0
    for x in xs: total += parse(x)?       # `?` returns the error early
    ok(total)
```

- `x?` inside a function returning `U?` returns `none` early if `x` is none; inside a function returning `U!E` it returns the error early if `x` is an error (the error types must match).
- `x!` unwraps an optional or result, panicking with a clear message if there is no value.
- `x ?? d` gives a default.
- Ignoring a result is a compile error (`_ = f()` ignores it on purpose).
- `panic("msg")` stops the program with a message and the `.tsa` location. `assert cond, "msg"` panics if `cond` is false.

## 10. Modules

A module is a `.tsa` file. Module paths are relative to the folder of the main file: `use lib.geometry` loads `lib/geometry.tsa`.

```
use geometry                 # import every public name
use geometry: area, Shape    # import only these
use lib.geometry as g        # qualified access: g.area(s), g.Shape, g.Circle(r) in patterns
```

Top-level names starting with `_` are private. Importing a choice type also imports its variants. Mutable top-level variables can't be imported (expose a function instead). Circular imports are an error.

## 11. Python interop

`extern` declares typed bindings to any Python module:

```
extern "math":
    fn gcd(a: int, b: int) -> int
    tau: float
extern "pathlib":
    type Path(name: str, suffix: str)      # opaque Python type; listed fields are readable
    fn Path(p: str) -> Path as path        # import a callable under another name
    fn Path.exists() -> bool               # a Python method
```

Values of type `dyn` (from `parse_json` or untyped interop) allow any operation without checks. Convert them with `as`, which checks at runtime: `data["age"] as int`, `data["tags"] as [str]`.

## 12. Tests

```
test "adds numbers":
    assert add(2, 3) == 5
```

`tersa test file.tsa` runs the file (top-level code first) and then every `test` block, reporting each result with the failing assertion's source text and location.

## 13. Program execution and errors

- Top-level statements run in order. Functions, types and tests may be declared anywhere in the file.
- `args()` returns command-line arguments; `exit(code)` stops.
- Runtime failures (out-of-range index, missing map key, division by zero, unwrapping none, `panic`) print `panic: <message>` followed by `at file.tsa:LINE in function` frames, and exit with status 1. Deep recursion is reported compactly.

## 14. Compilation model

`tersa run` and `tersa build` type-check the program, then generate one Python module per `.tsa` file plus a small runtime (`tersa_rt.py`). Records become frozen dataclasses (non-frozen if they have `var` fields), choice types become a base class with one dataclass per variant, `match` becomes Python `match`, results become `Ok`/`Err` objects, and `none` is Python `None`. The generated code is plain, readable Python.

## 15. Diagnostics

Every diagnostic has a stable code, a precise location, and usually a `help:` line with a concrete fix. `tersa check --json` prints machine-readable diagnostics for tools and AI agents:

```json
{ "ok": false, "diagnostics": [{ "severity": "error", "code": "E140", "message": "...", "file": "app.tsa", "line": 4, "col": 5, "endCol": 15, "hint": "..." }] }
```

| Code | Meaning |
|---|---|
| E001, E002 | syntax |
| E100 | unknown name |
| E101 | unknown type |
| E102 | unknown field or method |
| E110 | type mismatch |
| E111, E112, E113 | wrong number of arguments, missing argument, unknown named argument |
| E120 | reassigning an immutable variable |
| E121 | mutating through an immutable variable or field |
| E122 | duplicate declaration |
| E130, E131 | non-exhaustive match, unreachable arm |
| E140 | value may be none |
| E141 | value may be an error, or an important result is discarded |
| E150 | missing or misplaced return |
| E160 | misuse of `?` |
| E170 | condition is not a bool |
| E180 | invalid operation |
| E190–E193 | module errors |
| W200, W201 | unused variable, unreachable code (warnings) |
