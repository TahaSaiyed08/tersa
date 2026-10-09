# Contributing to Tersa

Thanks for helping! Tersa's goals, in priority order: **few tokens**, **few AI bugs**, **familiar to anyone who knows Python**.

## Setup

```
git clone https://github.com/smta08/tersa.git
cd tersa
npm install
npm test
```

You need Node.js 18+ and Python 3.10+.

## Layout

| Path | What it is |
|---|---|
| `src/lexer.ts` | source text → tokens (indentation, strings, interpolation) |
| `src/parser.ts` | tokens → AST |
| `src/checker.ts` | type checker and all diagnostics |
| `src/codegen.ts` | AST → Python |
| `src/builtins.ts` | standard library signatures and Python templates |
| `src/runtime.ts` | the Python runtime and bootstrap shipped with every program |
| `src/compile.ts` | module loading and the compile pipeline |
| `src/cli.ts` | the `tersa` command |
| `test/` | compiler tests (`node --test`) |
| `examples/` | runnable programs with expected output (`.out`) |
| `benchmarks/` | token and AI-bug benchmarks |

## Making changes

- **Adding a built-in:** add one line to `src/builtins.ts` (signature in Tersa syntax + Python template), then run `npm run build && node scripts/gen-stdlib-doc.mjs`.
- **Adding a check:** put it in `src/checker.ts`, give it a stable error code, and always include a `hint` that tells the reader exactly how to fix the code. Add a case to `test/errors.test.mjs`.
- **Changing syntax:** update `llms.txt` and `docs/SPEC.md`, and keep `llms.txt` short; every token there is paid on every prompt.
- Run `npm test` and `bash benchmarks/verify.sh` before opening a pull request. If you change syntax, run `npm run bench` and include the token numbers.
