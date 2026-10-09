# Tersa standard library

Generated from the compiler (`scripts/gen-stdlib-doc.mjs`). Every function can also be called as a method on its first argument: `xs.map(f)` is `map(xs, f)`.

`var` on the first parameter means the function changes that argument in place, so it must be a `var` variable or field.

## Output and conversion

| Signature | Notes |
|---|---|
| `print(x: dyn)` | Print values separated by spaces. Takes any number of arguments. |
| `str(x: dyn) -> str` |  |
| `int(x: float) -> int` | Truncate a float. To parse text use parse_int. |
| `float(x: float) -> float` |  |
| `parse_int(s: str) -> int?` |  |
| `parse_float(s: str) -> float?` |  |
| `len[T: sized](x: T) -> int` |  |
| `is_empty[T: sized](x: T) -> bool` |  |
| `some[T](x: T) -> T?` |  |
| `ok[T, E](value: T) -> T!E` |  |
| `err[T, E](error: E) -> T!E` |  |
| `panic(msg: str) -> never` |  |
| `exit(code: int = 0) -> never` |  |

## Ranges

| Signature | Notes |
|---|---|
| `range(stop: int) -> [int]` |  |
| `range(start: int, stop: int) -> [int]` |  |
| `range(start: int, stop: int, step: int) -> [int]` |  |

## Math

| Signature | Notes |
|---|---|
| `abs[N: num](x: N) -> N` |  |
| `min[T: ord](xs: [T]) -> T` |  |
| `min[T: ord](a: T, b: T) -> T` |  |
| `max[T: ord](xs: [T]) -> T` |  |
| `max[T: ord](a: T, b: T) -> T` |  |
| `sum[N: num](xs: [N]) -> N` |  |
| `clamp[N: num](x: N, lo: N, hi: N) -> N` |  |
| `round(x: float) -> int` |  |
| `round(x: float, digits: int) -> float` |  |
| `floor(x: float) -> int` |  |
| `ceil(x: float) -> int` |  |
| `sqrt(x: float) -> float` |  |
| `sin(x: float) -> float` |  |
| `cos(x: float) -> float` |  |
| `tan(x: float) -> float` |  |
| `atan2(y: float, x: float) -> float` |  |
| `log(x: float) -> float` |  |
| `log10(x: float) -> float` |  |
| `exp(x: float) -> float` |  |
| `random() -> float` |  |
| `rand_int(lo: int, hi: int) -> int` | Random int in lo..=hi |
| `choice[T](xs: [T]) -> T` |  |
| `shuffle[T](xs: [T]) -> [T]` |  |

## Strings

| Signature | Notes |
|---|---|
| `upper(s: str) -> str` |  |
| `lower(s: str) -> str` |  |
| `trim(s: str) -> str` |  |
| `trim_start(s: str) -> str` |  |
| `trim_end(s: str) -> str` |  |
| `split(s: str) -> [str]` | Split on whitespace |
| `split(s: str, sep: str) -> [str]` |  |
| `lines(s: str) -> [str]` |  |
| `replace(s: str, old: str, new: str) -> str` |  |
| `starts_with(s: str, prefix: str) -> bool` |  |
| `ends_with(s: str, suffix: str) -> bool` |  |
| `find(s: str, sub: str) -> int?` | Index of sub, or none |
| `count(s: str, sub: str) -> int` |  |
| `chars(s: str) -> [str]` |  |
| `reverse(s: str) -> str` |  |
| `pad_left(s: str, width: int, fill: str = " ") -> str` |  |
| `pad_right(s: str, width: int, fill: str = " ") -> str` |  |
| `is_digit(s: str) -> bool` |  |
| `is_alpha(s: str) -> bool` |  |
| `is_space(s: str) -> bool` |  |
| `contains(s: str, sub: str) -> bool` |  |
| `ord(c: str) -> int` |  |

## Lists

| Signature | Notes |
|---|---|
| `join(xs: [str]) -> str` |  |
| `join(xs: [str], sep: str) -> str` |  |
| `fmt(x: float, digits: int) -> str` | Format with fixed decimals: fmt(3.14159, 2) == "3.14" |
| `chr(code: int) -> str` |  |
| `push[T](var xs: [T], x: T)` | mutates its first argument |
| `pop[T](var xs: [T]) -> T` | mutates its first argument |
| `insert[T](var xs: [T], i: int, x: T)` | mutates its first argument |
| `remove_at[T](var xs: [T], i: int) -> T` | mutates its first argument |
| `remove[T](var xs: [T], x: T)` | Remove the first occurrence of x (no-op if absent) |
| `extend[T](var xs: [T], ys: [T])` | mutates its first argument |
| `clear[T](var xs: [T])` | mutates its first argument |
| `map[T, U](xs: [T], f: fn(T) -> U) -> [U]` |  |
| `filter[T](xs: [T], f: fn(T) -> bool) -> [T]` |  |
| `fold[T, A](xs: [T], init: A, f: fn(A, T) -> A) -> A` |  |
| `any(xs: [bool]) -> bool` |  |
| `any[T](xs: [T], f: fn(T) -> bool) -> bool` |  |
| `all(xs: [bool]) -> bool` |  |
| `all[T](xs: [T], f: fn(T) -> bool) -> bool` |  |
| `count[T](xs: [T], f: fn(T) -> bool) -> int` |  |
| `find[T](xs: [T], f: fn(T) -> bool) -> T?` |  |
| `index_of[T](xs: [T], x: T) -> int?` |  |
| `contains[T](xs: [T], x: T) -> bool` |  |
| `first[T](xs: [T]) -> T?` |  |
| `last[T](xs: [T]) -> T?` |  |
| `get[T](xs: [T], i: int) -> T?` |  |
| `sort[T: ord](xs: [T]) -> [T]` | Returns a new sorted list |
| `sort_by[T, K: ord](xs: [T], key: fn(T) -> K) -> [T]` |  |
| `sort_desc[T: ord](xs: [T]) -> [T]` |  |
| `reverse[T](xs: [T]) -> [T]` |  |
| `min_by[T, K: ord](xs: [T], key: fn(T) -> K) -> T` |  |
| `max_by[T, K: ord](xs: [T], key: fn(T) -> K) -> T` |  |
| `enumerate[T](xs: [T]) -> [(int, T)]` |  |
| `zip[A, B](a: [A], b: [B]) -> [(A, B)]` |  |
| `flatten[T](xs: [[T]]) -> [T]` |  |
| `unique[T: hash](xs: [T]) -> [T]` | Remove duplicates, keeping order |
| `group_by[T, K: hash](xs: [T], key: fn(T) -> K) -> {K: [T]}` |  |
| `copy[T](xs: [T]) -> [T]` |  |
| `set[T: hash]() -> set[T]` |  |
| `set[T: hash](xs: [T]) -> set[T]` |  |

## Maps

| Signature | Notes |
|---|---|
| `get[K, V](m: {K: V}, key: K) -> V?` |  |
| `keys[K, V](m: {K: V}) -> [K]` |  |
| `values[K, V](m: {K: V}) -> [V]` |  |
| `items[K, V](m: {K: V}) -> [(K, V)]` |  |
| `remove[K, V](var m: {K: V}, key: K)` | mutates its first argument |
| `clear[K, V](var m: {K: V})` | mutates its first argument |
| `merge[K, V](a: {K: V}, b: {K: V}) -> {K: V}` |  |
| `contains[K, V](m: {K: V}, key: K) -> bool` |  |
| `copy[K, V](m: {K: V}) -> {K: V}` |  |

## Sets

| Signature | Notes |
|---|---|
| `add[T](var s: set[T], x: T)` | mutates its first argument |
| `remove[T](var s: set[T], x: T)` | mutates its first argument |
| `clear[T](var s: set[T])` | mutates its first argument |
| `union[T](a: set[T], b: set[T]) -> set[T]` |  |
| `intersect[T](a: set[T], b: set[T]) -> set[T]` |  |
| `difference[T](a: set[T], b: set[T]) -> set[T]` |  |
| `to_list[T: ord](s: set[T]) -> [T]` | Sorted list of the set's items |
| `contains[T](s: set[T], x: T) -> bool` |  |

## Files, system, JSON

| Signature | Notes |
|---|---|
| `input(prompt: str = "") -> str` |  |
| `args() -> [str]` |  |
| `read_file(path: str) -> str!str` |  |
| `write_file(path: str, text: str) -> ()!str` |  |
| `append_file(path: str, text: str) -> ()!str` |  |
| `file_exists(path: str) -> bool` |  |
| `env(name: str) -> str?` |  |
| `now() -> float` | Seconds since the Unix epoch |
| `sleep(seconds: float)` |  |
| `to_json(x: dyn) -> str` |  |
| `parse_json(s: str) -> dyn!str` |  |

## Constants

`pi`, `inf`
