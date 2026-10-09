from dataclasses import dataclass


@dataclass
class Item:
    name: str
    qty: int
    min_qty: int
    price: float


stock: dict[str, Item] = {}
for it in [Item("apple", 50, 20, 0.5), Item("bread", 5, 10, 2.25), Item("milk", 8, 12, 1.2), Item("rice", 30, 5, 3.0)]:
    stock[it.name] = it


def sell(name: str, n: int) -> None:
    item = stock.get(name)
    if item is None:
        raise ValueError(f"unknown item {name}")
    if item.qty < n:
        raise ValueError(f"only {item.qty} {name} left")
    item.qty -= n


for name, n in [("apple", 35), ("milk", 10), ("tea", 1), ("bread", 2)]:
    try:
        sell(name, n)
        print(f"sold {n} {name}")
    except ValueError as e:
        print(f"cannot sell: {e}")

low: list[Item] = sorted([i for i in stock.values() if i.qty < i.min_qty], key=lambda i: i.qty)
print(f"restock: {', '.join(i.name for i in low)}")
value: float = sum(i.qty * i.price for i in stock.values())
print(f"stock value: {value:.2f}")
