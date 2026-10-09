from collections import defaultdict
from dataclasses import dataclass


@dataclass(frozen=True)
class Sale:
    region: str
    product: str
    units: int
    price: float


def parse_line(line: str, n: int) -> Sale:
    cols = line.split(",")
    if len(cols) != 4:
        raise ValueError(f"line {n}: expected 4 columns, got {len(cols)}")
    try:
        units = int(cols[2].strip())
    except ValueError:
        raise ValueError(f"line {n}: bad units '{cols[2]}'")
    try:
        price = float(cols[3].strip())
    except ValueError:
        raise ValueError(f"line {n}: bad price '{cols[3]}'")
    return Sale(cols[0].strip(), cols[1].strip(), units, price)


data: str = """region,product,units,price
west,widget,10,2.50
east,gadget,3,10.00
west,gadget,oops,10.00
east,widget,7,2.50
north,widget,1
west,widget,5,2.50"""

sales: list[Sale] = []
errors: list[str] = []
for i, line in enumerate(data.splitlines()[1:]):
    try:
        sales.append(parse_line(line, i + 2))
    except ValueError as e:
        errors.append(str(e))

by_region: defaultdict[str, list[Sale]] = defaultdict(list)
for s in sales:
    by_region[s.region].append(s)
for region in sorted(by_region):
    rows = by_region[region]
    revenue = sum(s.units * s.price for s in rows)
    print(f"{region}: {len(rows)} sales, revenue {revenue:.2f}")
print(f"skipped {len(errors)} bad lines:")
for e in errors:
    print(f"  {e}")
