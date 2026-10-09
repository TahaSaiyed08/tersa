const text = `the quick brown fox jumps over the lazy dog
the dog barks and the fox runs away quick`;

const counts = new Map<string, number>();
for (const word of text.toLowerCase().split(/\s+/)) {
  counts.set(word, (counts.get(word) ?? 0) + 1);
}

const top = [...counts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 3);
for (const [word, n] of top) {
  console.log(`${word}: ${n}`);
}
console.log(`unique words: ${counts.size}`);
