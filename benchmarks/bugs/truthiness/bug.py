def describe(discount: float | None) -> str:
    if discount:
        return f"discount {discount}"
    return "no discount"

print(describe(0.0))  # a real 0% discount is reported as "no discount"
