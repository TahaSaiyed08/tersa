from dataclasses import dataclass, field


@dataclass
class Task:
    id: int
    title: str
    done: bool = False
    tags: list[str] = field(default_factory=list)


tasks: list[Task] = []
next_id: int = 1


def add(title: str, tags: list[str] | None = None) -> Task:
    global next_id
    t = Task(next_id, title, tags=tags or [])
    next_id += 1
    tasks.append(t)
    return t


def complete(id: int) -> None:
    t = next((t for t in tasks if t.id == id), None)
    if t is None:
        raise ValueError(f"no task #{id}")
    if t.done:
        raise ValueError(f"task #{id} is already done")
    t.done = True


add("write spec", ["docs"])
add("build compiler", ["code"])
add("publish to npm", ["release", "code"])
complete(2)
for id in [2, 9]:
    try:
        complete(id)
        print("ok")
    except ValueError as e:
        print(f"error: {e}")

for t in tasks:
    mark = "x" if t.done else " "
    print(f"[{mark}] #{t.id} {t.title} ({', '.join(t.tags)})")
code_left = len([t for t in tasks if not t.done and "code" in t.tags])
print(f"{sum(1 for t in tasks if t.done)}/{len(tasks)} done, {code_left} code task(s) left")
