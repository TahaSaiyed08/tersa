def add_tag(tag: str, tags: list[str] = []) -> list[str]:
    tags.append(tag)
    return tags

print(add_tag("a"))
print(add_tag("b"))  # ['a', 'b'] - state leaks between calls
