text: str = """the quick brown fox jumps over the lazy dog
the dog barks and the fox runs away quick"""

counts: dict[str, int] = {}
for word in text.lower().split():
    counts[word] = counts.get(word, 0) + 1

top: list[tuple[str, int]] = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:3]
for word, n in top:
    print(f"{word}: {n}")
print(f"unique words: {len(counts)}")
