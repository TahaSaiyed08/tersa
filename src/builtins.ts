// Tersa standard library: typed signatures (written in Tersa syntax) + Python implementations.
//
// `py` is a Python expression template: {0}, {1}, ... are the arguments in order.
// `mut` means the first argument is mutated, so it must be a mutable place (a `var`).
// `pure` means discarding the result is almost certainly a bug (e.g. `xs.sort()` as a statement).
// `lazy` means the Python form is an iterator: inside `for`/comprehensions it is used raw, elsewhere wrapped in list().

export interface BuiltinDef {
  sig: string;
  py: string;
  mut?: boolean;
  pure?: boolean;
  lazy?: string; // raw iterator template, used when iterated directly
  doc?: string;
}

export const BUILTINS: BuiltinDef[] = [
  // ---- output / conversion ----
  { sig: "print(x: dyn)", py: "print({*})", doc: "Print values separated by spaces. Takes any number of arguments." },
  { sig: "str(x: dyn) -> str", py: "_rt.show({0})", pure: true },
  { sig: "int(x: float) -> int", py: "int({0})", pure: true, doc: "Truncate a float. To parse text use parse_int." },
  { sig: "float(x: float) -> float", py: "float({0})", pure: true },
  { sig: "parse_int(s: str) -> int?", py: "_rt.parse_int({0})", pure: true },
  { sig: "parse_float(s: str) -> float?", py: "_rt.parse_float({0})", pure: true },
  { sig: "len[T: sized](x: T) -> int", py: "len({0})", pure: true },
  { sig: "is_empty[T: sized](x: T) -> bool", py: "(len({0}) == 0)", pure: true },
  { sig: "some[T](x: T) -> T?", py: "{0}", pure: true },
  { sig: "ok[T, E](value: T) -> T!E", py: "_rt.Ok({0})", pure: true },
  { sig: "err[T, E](error: E) -> T!E", py: "_rt.Err({0})", pure: true },
  { sig: "panic(msg: str) -> never", py: "_rt.panic({0})" },
  { sig: "exit(code: int = 0) -> never", py: "_rt.sys.exit({0})" },

  // ---- ranges ----
  { sig: "range(stop: int) -> [int]", py: "list(range({0}))", lazy: "range({0})", pure: true },
  { sig: "range(start: int, stop: int) -> [int]", py: "list(range({0}, {1}))", lazy: "range({0}, {1})", pure: true },
  { sig: "range(start: int, stop: int, step: int) -> [int]", py: "list(range({0}, {1}, {2}))", lazy: "range({0}, {1}, {2})", pure: true },

  // ---- math ----
  { sig: "abs[N: num](x: N) -> N", py: "abs({0})", pure: true },
  { sig: "min[T: ord](xs: [T]) -> T", py: "min({0})", pure: true },
  { sig: "min[T: ord](a: T, b: T) -> T", py: "min({0}, {1})", pure: true },
  { sig: "max[T: ord](xs: [T]) -> T", py: "max({0})", pure: true },
  { sig: "max[T: ord](a: T, b: T) -> T", py: "max({0}, {1})", pure: true },
  { sig: "sum[N: num](xs: [N]) -> N", py: "sum({0})", pure: true },
  { sig: "clamp[N: num](x: N, lo: N, hi: N) -> N", py: "_rt.clamp({0}, {1}, {2})", pure: true },
  { sig: "round(x: float) -> int", py: "round({0})", pure: true },
  { sig: "round(x: float, digits: int) -> float", py: "round({0}, {1})", pure: true },
  { sig: "floor(x: float) -> int", py: "_rt.math.floor({0})", pure: true },
  { sig: "ceil(x: float) -> int", py: "_rt.math.ceil({0})", pure: true },
  { sig: "sqrt(x: float) -> float", py: "_rt.math.sqrt({0})", pure: true },
  { sig: "sin(x: float) -> float", py: "_rt.math.sin({0})", pure: true },
  { sig: "cos(x: float) -> float", py: "_rt.math.cos({0})", pure: true },
  { sig: "tan(x: float) -> float", py: "_rt.math.tan({0})", pure: true },
  { sig: "atan2(y: float, x: float) -> float", py: "_rt.math.atan2({0}, {1})", pure: true },
  { sig: "log(x: float) -> float", py: "_rt.math.log({0})", pure: true },
  { sig: "log10(x: float) -> float", py: "_rt.math.log10({0})", pure: true },
  { sig: "exp(x: float) -> float", py: "_rt.math.exp({0})", pure: true },
  { sig: "random() -> float", py: "_rt.random.random()" },
  { sig: "rand_int(lo: int, hi: int) -> int", py: "_rt.random.randint({0}, {1})", doc: "Random int in lo..=hi" },
  { sig: "choice[T](xs: [T]) -> T", py: "_rt.random.choice({0})" },
  { sig: "shuffle[T](xs: [T]) -> [T]", py: "_rt.shuffled({0})", pure: true },

  // ---- strings ----
  { sig: "upper(s: str) -> str", py: "{0}.upper()", pure: true },
  { sig: "lower(s: str) -> str", py: "{0}.lower()", pure: true },
  { sig: "trim(s: str) -> str", py: "{0}.strip()", pure: true },
  { sig: "trim_start(s: str) -> str", py: "{0}.lstrip()", pure: true },
  { sig: "trim_end(s: str) -> str", py: "{0}.rstrip()", pure: true },
  { sig: "split(s: str) -> [str]", py: "{0}.split()", pure: true, doc: "Split on whitespace" },
  { sig: "split(s: str, sep: str) -> [str]", py: "{0}.split({1})", pure: true },
  { sig: "lines(s: str) -> [str]", py: "{0}.splitlines()", pure: true },
  { sig: "join(xs: [str]) -> str", py: "''.join({0})", pure: true },
  { sig: "join(xs: [str], sep: str) -> str", py: "{1}.join({0})", pure: true },
  { sig: "replace(s: str, old: str, new: str) -> str", py: "{0}.replace({1}, {2})", pure: true },
  { sig: "starts_with(s: str, prefix: str) -> bool", py: "{0}.startswith({1})", pure: true },
  { sig: "ends_with(s: str, suffix: str) -> bool", py: "{0}.endswith({1})", pure: true },
  { sig: "find(s: str, sub: str) -> int?", py: "_rt.find_str({0}, {1})", pure: true, doc: "Index of sub, or none" },
  { sig: "count(s: str, sub: str) -> int", py: "{0}.count({1})", pure: true },
  { sig: "chars(s: str) -> [str]", py: "list({0})", pure: true },
  { sig: "reverse(s: str) -> str", py: "{0}[::-1]", pure: true },
  { sig: "pad_left(s: str, width: int, fill: str = \" \") -> str", py: "{0}.rjust({1}, {2})", pure: true },
  { sig: "pad_right(s: str, width: int, fill: str = \" \") -> str", py: "{0}.ljust({1}, {2})", pure: true },
  { sig: "is_digit(s: str) -> bool", py: "{0}.isdigit()", pure: true },
  { sig: "is_alpha(s: str) -> bool", py: "{0}.isalpha()", pure: true },
  { sig: "is_space(s: str) -> bool", py: "{0}.isspace()", pure: true },
  { sig: "contains(s: str, sub: str) -> bool", py: "({1} in {0})", pure: true },
  { sig: "fmt(x: float, digits: int) -> str", py: "_rt.fmt({0}, {1})", pure: true, doc: "Format with fixed decimals: fmt(3.14159, 2) == \"3.14\"" },
  { sig: "ord(c: str) -> int", py: "ord({0})", pure: true },
  { sig: "chr(code: int) -> str", py: "chr({0})", pure: true },

  // ---- lists ----
  { sig: "push[T](var xs: [T], x: T)", py: "{0}.append({1})", mut: true },
  { sig: "pop[T](var xs: [T]) -> T", py: "{0}.pop()", mut: true },
  { sig: "insert[T](var xs: [T], i: int, x: T)", py: "{0}.insert({1}, {2})", mut: true },
  { sig: "remove_at[T](var xs: [T], i: int) -> T", py: "{0}.pop({1})", mut: true },
  { sig: "remove[T](var xs: [T], x: T)", py: "_rt.remove_value({0}, {1})", mut: true, doc: "Remove the first occurrence of x (no-op if absent)" },
  { sig: "extend[T](var xs: [T], ys: [T])", py: "{0}.extend({1})", mut: true },
  { sig: "clear[T](var xs: [T])", py: "{0}.clear()", mut: true },
  { sig: "map[T, U](xs: [T], f: fn(T) -> U) -> [U]", py: "list(map({1}, {0}))", pure: true },
  { sig: "filter[T](xs: [T], f: fn(T) -> bool) -> [T]", py: "list(filter({1}, {0}))", pure: true },
  { sig: "fold[T, A](xs: [T], init: A, f: fn(A, T) -> A) -> A", py: "_rt.fold({0}, {1}, {2})", pure: true },
  { sig: "any(xs: [bool]) -> bool", py: "any({0})", pure: true },
  { sig: "any[T](xs: [T], f: fn(T) -> bool) -> bool", py: "_rt.any_by({0}, {1})", pure: true },
  { sig: "all(xs: [bool]) -> bool", py: "all({0})", pure: true },
  { sig: "all[T](xs: [T], f: fn(T) -> bool) -> bool", py: "_rt.all_by({0}, {1})", pure: true },
  { sig: "count[T](xs: [T], f: fn(T) -> bool) -> int", py: "_rt.count_by({0}, {1})", pure: true },
  { sig: "find[T](xs: [T], f: fn(T) -> bool) -> T?", py: "_rt.find_by({0}, {1})", pure: true },
  { sig: "index_of[T](xs: [T], x: T) -> int?", py: "_rt.index_of({0}, {1})", pure: true },
  { sig: "contains[T](xs: [T], x: T) -> bool", py: "({1} in {0})", pure: true },
  { sig: "first[T](xs: [T]) -> T?", py: "_rt.first({0})", pure: true },
  { sig: "last[T](xs: [T]) -> T?", py: "_rt.last({0})", pure: true },
  { sig: "get[T](xs: [T], i: int) -> T?", py: "_rt.get_index({0}, {1})", pure: true },
  { sig: "sort[T: ord](xs: [T]) -> [T]", py: "sorted({0})", pure: true, doc: "Returns a new sorted list" },
  { sig: "sort_by[T, K: ord](xs: [T], key: fn(T) -> K) -> [T]", py: "sorted({0}, key={1})", pure: true },
  { sig: "sort_desc[T: ord](xs: [T]) -> [T]", py: "sorted({0}, reverse=True)", pure: true },
  { sig: "reverse[T](xs: [T]) -> [T]", py: "{0}[::-1]", pure: true },
  { sig: "min_by[T, K: ord](xs: [T], key: fn(T) -> K) -> T", py: "min({0}, key={1})", pure: true },
  { sig: "max_by[T, K: ord](xs: [T], key: fn(T) -> K) -> T", py: "max({0}, key={1})", pure: true },
  { sig: "enumerate[T](xs: [T]) -> [(int, T)]", py: "list(enumerate({0}))", lazy: "enumerate({0})", pure: true },
  { sig: "zip[A, B](a: [A], b: [B]) -> [(A, B)]", py: "list(zip({0}, {1}))", lazy: "zip({0}, {1})", pure: true },
  { sig: "flatten[T](xs: [[T]]) -> [T]", py: "_rt.flatten({0})", pure: true },
  { sig: "unique[T: hash](xs: [T]) -> [T]", py: "list(dict.fromkeys({0}))", pure: true, doc: "Remove duplicates, keeping order" },
  { sig: "group_by[T, K: hash](xs: [T], key: fn(T) -> K) -> {K: [T]}", py: "_rt.group_by({0}, {1})", pure: true },
  { sig: "copy[T](xs: [T]) -> [T]", py: "list({0})", pure: true },

  // ---- maps ----
  { sig: "get[K, V](m: {K: V}, key: K) -> V?", py: "{0}.get({1})", pure: true },
  { sig: "keys[K, V](m: {K: V}) -> [K]", py: "list({0}.keys())", lazy: "{0}.keys()", pure: true },
  { sig: "values[K, V](m: {K: V}) -> [V]", py: "list({0}.values())", lazy: "{0}.values()", pure: true },
  { sig: "items[K, V](m: {K: V}) -> [(K, V)]", py: "list({0}.items())", lazy: "{0}.items()", pure: true },
  { sig: "remove[K, V](var m: {K: V}, key: K)", py: "{0}.pop({1}, None)", mut: true },
  { sig: "clear[K, V](var m: {K: V})", py: "{0}.clear()", mut: true },
  { sig: "merge[K, V](a: {K: V}, b: {K: V}) -> {K: V}", py: "{**{0}, **{1}}", pure: true },
  { sig: "contains[K, V](m: {K: V}, key: K) -> bool", py: "({1} in {0})", pure: true },
  { sig: "copy[K, V](m: {K: V}) -> {K: V}", py: "dict({0})", pure: true },

  // ---- sets ----
  { sig: "set[T: hash]() -> set[T]", py: "set()", pure: true },
  { sig: "set[T: hash](xs: [T]) -> set[T]", py: "set({0})", pure: true },
  { sig: "add[T](var s: set[T], x: T)", py: "{0}.add({1})", mut: true },
  { sig: "remove[T](var s: set[T], x: T)", py: "{0}.discard({1})", mut: true },
  { sig: "clear[T](var s: set[T])", py: "{0}.clear()", mut: true },
  { sig: "union[T](a: set[T], b: set[T]) -> set[T]", py: "({0} | {1})", pure: true },
  { sig: "intersect[T](a: set[T], b: set[T]) -> set[T]", py: "({0} & {1})", pure: true },
  { sig: "difference[T](a: set[T], b: set[T]) -> set[T]", py: "({0} - {1})", pure: true },
  { sig: "to_list[T: ord](s: set[T]) -> [T]", py: "sorted({0})", pure: true, doc: "Sorted list of the set's items" },
  { sig: "contains[T](s: set[T], x: T) -> bool", py: "({1} in {0})", pure: true },

  // ---- I/O, system ----
  { sig: "input(prompt: str = \"\") -> str", py: "input({0})" },
  { sig: "args() -> [str]", py: "_rt.sys.argv[1:]" },
  { sig: "read_file(path: str) -> str!str", py: "_rt.read_file({0})" },
  { sig: "write_file(path: str, text: str) -> ()!str", py: "_rt.write_file({0}, {1})" },
  { sig: "append_file(path: str, text: str) -> ()!str", py: "_rt.append_file({0}, {1})" },
  { sig: "file_exists(path: str) -> bool", py: "_rt.os.path.exists({0})" },
  { sig: "env(name: str) -> str?", py: "_rt.os.environ.get({0})" },
  { sig: "now() -> float", py: "_rt.time.time()", doc: "Seconds since the Unix epoch" },
  { sig: "sleep(seconds: float)", py: "_rt.time.sleep({0})" },
  { sig: "to_json(x: dyn) -> str", py: "_rt.to_json({0})", pure: true },
  { sig: "parse_json(s: str) -> dyn!str", py: "_rt.parse_json({0})" },
];

export const CONSTANTS: { name: string; type: string; py: string }[] = [
  { name: "pi", type: "float", py: "_rt.math.pi" },
  { name: "inf", type: "float", py: "_rt.math.inf" },
];

/** Python built-in and module names generated code relies on; user identifiers that collide get a trailing "_". */
export const PY_RESERVED = new Set([
  // keywords
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield",
  // builtins used by templates or that would be confusing to shadow
  "abs", "all", "any", "bool", "chr", "dict", "enumerate", "filter", "float", "int", "isinstance", "len", "list", "map",
  "max", "min", "ord", "print", "range", "round", "set", "sorted", "str", "sum", "tuple", "zip", "object", "type",
  "input", "iter", "next", "super", "repr", "hash", "id", "open", "format", "reversed", "slice", "vars", "dir",
  "getattr", "setattr", "hasattr", "callable", "divmod", "pow", "exec", "eval", "compile", "globals", "locals",
  "frozenset", "bytes", "property", "staticmethod", "classmethod", "exit", "quit", "help", "breakpoint",
]);

export const PY_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield",
]);
