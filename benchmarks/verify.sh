#!/usr/bin/env bash
# Runs every benchmark program in every language and checks the output matches expected.txt.
# Needs: node, python3 (3.10+), javac/java (21+), go (1.21+). Missing toolchains are skipped.
set -u
cd "$(dirname "$0")/tasks"
ROOT="$(cd ../.. && pwd)"
TMP="$(mktemp -d)"
fail=0
check() { # task label output
  if [ "$3" == "$(cat "$1/expected.txt")" ]; then echo "ok    $1 ($2)"; else echo "FAIL  $1 ($2)"; fail=1; fi
}
for t in */; do
  t=${t%/}
  check "$t" tersa "$(node "$ROOT/dist/cli.js" run "$t/main.tsa" 2>&1)"
  command -v python3 >/dev/null && check "$t" python "$(python3 "$t/main.py" 2>&1)" && check "$t" python-typed "$(python3 "$t/typed.py" 2>&1)"
  if [ -x "$ROOT/node_modules/.bin/tsc" ]; then
    "$ROOT/node_modules/.bin/tsc" --strict --target es2022 --module commonjs --lib es2022 --types node --typeRoots "$ROOT/node_modules/@types" --outDir "$TMP/ts/$t" "$t/main.ts" && check "$t" typescript "$(node "$TMP/ts/$t/main.js" 2>&1)"
  fi
  if command -v javac >/dev/null; then
    javac -d "$TMP/java/$t" "$t/Main.java" 2>/dev/null && check "$t" java "$(java -cp "$TMP/java/$t" Main 2>/dev/null)"
  fi
  command -v go >/dev/null && check "$t" go "$(cd "$t" && go run main.go 2>&1)"
done
rm -rf "$TMP"
exit $fail
