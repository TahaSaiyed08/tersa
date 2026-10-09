from typing import Callable

handlers: list[Callable[[], int]] = []
for i in range(3):
    handlers.append(lambda: i)
print([h() for h in handlers])  # [2, 2, 2]
