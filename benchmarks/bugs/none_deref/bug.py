users: dict[int, str] = {1: "alice"}

def shout(uid: int) -> str:
    name = users.get(uid)
    return name.upper()

print(shout(1))
print(shout(2))
