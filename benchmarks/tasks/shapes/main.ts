type Shape =
  | { kind: "circle"; r: number }
  | { kind: "rect"; w: number; h: number }
  | { kind: "triangle"; a: number; b: number; c: number };

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.r * s.r;
    case "rect":
      return s.w * s.h;
    case "triangle": {
      const p = (s.a + s.b + s.c) / 2;
      return Math.sqrt(p * (p - s.a) * (p - s.b) * (p - s.c));
    }
  }
}

function perimeter(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return 2 * Math.PI * s.r;
    case "rect":
      return 2 * (s.w + s.h);
    case "triangle":
      return s.a + s.b + s.c;
  }
}

const shapes: Shape[] = [
  { kind: "circle", r: 1 },
  { kind: "rect", w: 3, h: 4 },
  { kind: "triangle", a: 3, b: 4, c: 5 },
];
for (const s of shapes) {
  console.log(`${s.kind}: area=${area(s).toFixed(2)} perimeter=${perimeter(s).toFixed(2)}`);
}
const largest = shapes.reduce((best, s) => (area(s) > area(best) ? s : best));
console.log(`largest: ${largest.kind}`);
console.log(`total area: ${shapes.reduce((sum, s) => sum + area(s), 0).toFixed(2)}`);
