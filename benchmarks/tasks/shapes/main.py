import math
from dataclasses import dataclass


@dataclass
class Circle:
    r: float


@dataclass
class Rect:
    w: float
    h: float


@dataclass
class Triangle:
    a: float
    b: float
    c: float


def name(s):
    match s:
        case Circle():
            return "circle"
        case Rect():
            return "rect"
        case Triangle():
            return "triangle"


def area(s):
    match s:
        case Circle(r):
            return math.pi * r * r
        case Rect(w, h):
            return w * h
        case Triangle(a, b, c):
            p = (a + b + c) / 2
            return math.sqrt(p * (p - a) * (p - b) * (p - c))


def perimeter(s):
    match s:
        case Circle(r):
            return 2 * math.pi * r
        case Rect(w, h):
            return 2 * (w + h)
        case Triangle(a, b, c):
            return a + b + c


shapes = [Circle(1.0), Rect(3.0, 4.0), Triangle(3.0, 4.0, 5.0)]
for s in shapes:
    print(f"{name(s)}: area={area(s):.2f} perimeter={perimeter(s):.2f}")
print(f"largest: {name(max(shapes, key=area))}")
print(f"total area: {sum(area(s) for s in shapes):.2f}")
