def total(fields: list[str]) -> int:
    return sum(int(f) for f in fields)

print(total(["1", "2", "three"]))
