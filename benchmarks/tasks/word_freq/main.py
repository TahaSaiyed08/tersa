text = """the quick brown fox jumps over the lazy dog
the dog barks and the fox runs away quick"""

counts = {}
for word in text.lower().split():
    counts[word] = counts.get(word, 0) + 1

top = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:3]
for word, n in top:
    print(f"{word}: {n}")
print(f"unique words: {len(counts)}")
