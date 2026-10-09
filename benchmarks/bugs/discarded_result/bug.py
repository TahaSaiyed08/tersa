def clean(name: str) -> str:
    name.strip()
    return name

print(repr(clean("  bob  ")))
