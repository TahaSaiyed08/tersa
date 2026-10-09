interface Item {
  name: string;
  qty: number;
  minQty: number;
  price: number;
}

const stock = new Map<string, Item>();
for (const it of [
  { name: "apple", qty: 50, minQty: 20, price: 0.5 },
  { name: "bread", qty: 5, minQty: 10, price: 2.25 },
  { name: "milk", qty: 8, minQty: 12, price: 1.2 },
  { name: "rice", qty: 30, minQty: 5, price: 3.0 },
]) {
  stock.set(it.name, it);
}

function sell(name: string, n: number): void {
  const item = stock.get(name);
  if (item === undefined) throw new Error(`unknown item ${name}`);
  if (item.qty < n) throw new Error(`only ${item.qty} ${name} left`);
  item.qty -= n;
}

for (const [name, n] of [["apple", 35], ["milk", 10], ["tea", 1], ["bread", 2]] as [string, number][]) {
  try {
    sell(name, n);
    console.log(`sold ${n} ${name}`);
  } catch (e) {
    console.log(`cannot sell: ${(e as Error).message}`);
  }
}

const items = [...stock.values()];
const low = items.filter((i) => i.qty < i.minQty).sort((a, b) => a.qty - b.qty);
console.log(`restock: ${low.map((i) => i.name).join(", ")}`);
const value = items.reduce((sum, i) => sum + i.qty * i.price, 0);
console.log(`stock value: ${value.toFixed(2)}`);
