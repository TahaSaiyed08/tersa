def grade(score: int) -> str:
    if score >= 90:
        return "A"
    elif score >= 50:
        return "pass"

print(grade(30).upper())
