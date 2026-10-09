type Tree<T> = { left: Tree<T>; value: T; right: Tree<T> } | null;

function insert<T>(t: Tree<T>, v: T): Tree<T> {
  if (t === null) return { left: null, value: v, right: null };
  if (v < t.value) return { left: insert(t.left, v), value: t.value, right: t.right };
  if (v > t.value) return { left: t.left, value: t.value, right: insert(t.right, v) };
  return t;
}

function toList<T>(t: Tree<T>): T[] {
  if (t === null) return [];
  return [...toList(t.left), t.value, ...toList(t.right)];
}

function height<T>(t: Tree<T>): number {
  if (t === null) return 0;
  return 1 + Math.max(height(t.left), height(t.right));
}

function contains<T>(t: Tree<T>, v: T): boolean {
  if (t === null) return false;
  if (v === t.value) return true;
  return v < t.value ? contains(t.left, v) : contains(t.right, v);
}

let t: Tree<number> = null;
for (const v of [50, 30, 70, 20, 40, 60, 80, 30]) {
  t = insert(t, v);
}
console.log(toList(t).join(" "));
console.log(`height: ${height(t)}, has 60: ${contains(t, 60)}, has 65: ${contains(t, 65)}`);
let words: Tree<string> = null;
for (const w of "pear apple fig".split(" ")) {
  words = insert(words, w);
}
console.log(toList(words).join(" "));
