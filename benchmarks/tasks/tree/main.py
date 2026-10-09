from dataclasses import dataclass


@dataclass
class Node:
    left: "Node | None"
    value: object
    right: "Node | None"


def insert(t, v):
    if t is None:
        return Node(None, v, None)
    if v < t.value:
        return Node(insert(t.left, v), t.value, t.right)
    elif v > t.value:
        return Node(t.left, t.value, insert(t.right, v))
    else:
        return t


def to_list(t):
    if t is None:
        return []
    return to_list(t.left) + [t.value] + to_list(t.right)


def height(t):
    if t is None:
        return 0
    return 1 + max(height(t.left), height(t.right))


def contains(t, v):
    if t is None:
        return False
    if v == t.value:
        return True
    elif v < t.value:
        return contains(t.left, v)
    else:
        return contains(t.right, v)


t = None
for v in [50, 30, 70, 20, 40, 60, 80, 30]:
    t = insert(t, v)
print(" ".join(str(x) for x in to_list(t)))
print(f"height: {height(t)}, has 60: {str(contains(t, 60)).lower()}, has 65: {str(contains(t, 65)).lower()}")
words = None
for w in "pear apple fig".split():
    words = insert(words, w)
print(" ".join(to_list(words)))
