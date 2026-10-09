# Changelog

## 0.1.0 - 2026-10-09

First release.

- Language: records, choice types, generics with constraints, optionals (`T?`), results (`T!E`, `!E`), exhaustive `match`, lambdas, comprehensions, ranges, sets, string interpolation with format specs, raw strings, modules, typed Python interop (`extern`), `test` blocks.
- Type checker: local and return-type inference, flow-sensitive narrowing, mutability tracking, exhaustiveness and reachability checks, discarded-result detection, and a fix hint on every common error.
- Compiler to readable Python 3.10+, with runtime errors mapped back to `.tsa` lines.
- CLI: `run`, `check` (with `--json`), `build`, `test`, `spec`.
- 128-function standard library.
- Token benchmark (vs Python, typed Python, TypeScript, Go, Java) and AI-bug benchmark (vs Python and mypy).
