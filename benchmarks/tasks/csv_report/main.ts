interface Sale {
  region: string;
  product: string;
  units: number;
  price: number;
}

function parseLine(line: string, n: number): Sale {
  const cols = line.split(",");
  if (cols.length !== 4) throw new Error(`line ${n}: expected 4 columns, got ${cols.length}`);
  const units = Number(cols[2].trim());
  const price = Number(cols[3].trim());
  if (!Number.isInteger(units) || cols[2].trim() === "") throw new Error(`line ${n}: bad units '${cols[2]}'`);
  if (Number.isNaN(price) || cols[3].trim() === "") throw new Error(`line ${n}: bad price '${cols[3]}'`);
  return { region: cols[0].trim(), product: cols[1].trim(), units, price };
}

const data = `region,product,units,price
west,widget,10,2.50
east,gadget,3,10.00
west,gadget,oops,10.00
east,widget,7,2.50
north,widget,1
west,widget,5,2.50`;

const sales: Sale[] = [];
const errors: string[] = [];
data.split("\n").slice(1).forEach((line, i) => {
  try {
    sales.push(parseLine(line, i + 2));
  } catch (e) {
    errors.push((e as Error).message);
  }
});

const byRegion = new Map<string, Sale[]>();
for (const s of sales) {
  const rows = byRegion.get(s.region) ?? [];
  rows.push(s);
  byRegion.set(s.region, rows);
}
for (const region of [...byRegion.keys()].sort()) {
  const rows = byRegion.get(region)!;
  const revenue = rows.reduce((sum, s) => sum + s.units * s.price, 0);
  console.log(`${region}: ${rows.length} sales, revenue ${revenue.toFixed(2)}`);
}
console.log(`skipped ${errors.length} bad lines:`);
for (const e of errors) {
  console.log(`  ${e}`);
}
