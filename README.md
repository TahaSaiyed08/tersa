# Tersa

**A compact, type-safe programming language designed for code written by AI.**

Tersa looks like Python, so language models already know how to write it. But it is statically typed, has no `null`, no exceptions for expected failures, and no truthiness, and its compiler explains every mistake with a concrete fix. Programs compile to readable Python 3.10+ and can use any Python library.

```
type Shape = Circle(r: float) | Rect(w: float, h: float)

fn area(s: Shape) -> float:
    match s:
        Circle(r): pi * r * r
        Rect(w, h): w * h

fn parse_size(s: str) -> float!str:
    n = s.parse_float()
    if n == none: return err("not a number: {s}")
    ok(n)

shapes = [Circle(1.0), Rect(2.0, parse_size("3.5")!)]
print("total area: {shapes.map(area).sum():.2f}")
```

## Why

LLMs write a lot of code now. Two things make that code expensive: **tokens** (every program is generated, read back, and edited token by token) and **bugs** (each runtime crash costs another round trip). Tersa is designed around both.

**Fewer tokens.** Eight identical programs, written idiomatically in each language and verified to print byte-identical output ([details](benchmarks/RESULTS.md)):

| Language | Tokens | vs Tersa |
|---|---:|---:|
| **Tersa** (statically typed) | **1,976** | |
| Python (untyped) | 2,100 | +6% |
| Python (type hints) | 2,384 | +21% |
| TypeScript | 2,472 | +25% |
| Go | 2,895 | +47% |
| Java | 3,127 | +58% |

Tersa is shorter than untyped Python while being fully type-checked. The whole language spec ([`llms.txt`](llms.txt)) is about 2,100 tokens, so you can paste it into any prompt.

**Fewer bugs.** Thirteen mistakes LLMs commonly make (none dereference, `str + int`, truthiness, a missing `match` case, discarded results, mutable defaults, loop-closure capture, and more) ([details](benchmarks/BUGS.md)):

| | Caught or prevented before running |
|---|---:|
| Plain Python | 0 / 13 (6 silently produced wrong results) |
| Python + mypy --strict | 6 / 13 |
| **Tersa** | **13 / 13** |

Every error tells the model exactly how to fix it:

```
error[E140] app.tsa:5:5: 'name' may be none, so calling .upper() isn't safe
  |
5 |     name.upper()
  |     ^^^^^^^^^^
  help: check first: if name != none: ..., or use name!.upper(...)
```

## Install

Requires [Node.js](https://nodejs.org) 18+ (for the compiler) and [Python](https://python.org) 3.10+ (to run programs).

```
npm install -g tersa
```

## Use

```
tersa run app.tsa            # type-check, compile, and run
tersa check app.tsa          # type-check only
tersa check app.tsa --json   # machine-readable diagnostics (for AI agents and editors)
tersa test app.tsa           # run test blocks
tersa build app.tsa -o out   # write Python files (run with: python out/app.py)
tersa spec                   # print the compact language spec for LLM prompts
```

## A quick tour

```
# variables: immutable by default
name = "Tersa"
var count = 0
count += 1

# functions: last expression is the result; return types are inferred
fn greet(who: str, excited: bool = false) = if excited: "Hi {who}!" else: "Hi {who}."

# records, with copy-and-update
type User(name: str, age: int, var visits: int = 0)
u = User("ada", 36)
older = u.with(age=37)

# optionals: none instead of null, and the compiler makes you handle it
fn find(users: [User], name: str) -> User? = users.find(u => u.name == name)
match find([u], "bob"):
    none: print("not found")
    some(user): print(user.age)

# results: errors are values; ? passes them up
fn load(path: str) -> {str: dyn}!str:
    text = read_file(path)?
    data = parse_json(text)?
    ok(data as {str: dyn})

# collections
evens = [x * x for x in 1..=10 if x % 2 == 0]
by_len = ["a", "bb", "cc"].group_by(s => len(s))
print(evens.sum(), by_len, "{0.4567:.1%}")

# any Python library, with declared types
extern "statistics":
    fn median(xs: [float]) -> float
print(median([3.0, 1.0, 2.0]))

test "greeting":
    assert greet("x") == "Hi x."
```

Learn more:
- [`llms.txt`](llms.txt): the whole language in ~2,100 tokens
- [`docs/SPEC.md`](docs/SPEC.md): full reference
- [`docs/STDLIB.md`](docs/STDLIB.md): standard library (128 functions)
- [`examples/`](examples): runnable programs

## Using Tersa with an AI model

1. Put the output of `tersa spec` in the system prompt (or project instructions).
2. Ask for Tersa code.
3. Run `tersa check file.tsa --json` and send any diagnostics back. Each one has an exact location and a `hint` with the fix, so models usually correct the code in one step.

## How it works

The compiler is written in TypeScript with no runtime dependencies:

```
.tsa source → lexer → parser → type checker → Python code generator → python3
```

- The type checker does local inference, generics with constraints, flow-sensitive narrowing for optionals, exhaustiveness checking, and mutability tracking.
- The generated Python is plain and readable: records become dataclasses, choice types become class hierarchies, `match` becomes Python `match`.
- Runtime errors are mapped back to `.tsa` lines: `panic: index out of range  at app.tsa:12 in total`.

## Status

Tersa is at v0.1. It is complete enough to write real programs (the examples, tests, and benchmarks all run), but:

- Runtime speed is Python's speed.
- There are no async functions, interfaces/traits, or a package manager yet.
- Editor support is syntax highlighting only ([`editors/vscode`](editors/vscode)); there is no language server yet.
- The token benchmark uses OpenAI's public tokenizers as a proxy, since not every model's tokenizer is public. The bug benchmark is a curated set of common mistake patterns, not a measured rate.

Roadmap: language server, formatter, traits, async, package manager, an LLM eval measuring how often models write compiling Tersa from the spec alone.

## Development

```
npm install
npm test             # builds and runs 100+ compiler tests
npm run bench        # token benchmark
npm run bench:bugs   # AI-bug benchmark (python3; mypy optional)
bash benchmarks/verify.sh   # checks every benchmark program prints identical output
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © Taha Saiyed
