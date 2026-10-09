DEFAULT_LIMITS: dict[str, int] = {"cpu": 2, "ram": 4}

def for_premium() -> dict[str, int]:
    limits = DEFAULT_LIMITS
    limits["cpu"] = 8
    return limits

for_premium()
print(DEFAULT_LIMITS)  # the shared default was changed
