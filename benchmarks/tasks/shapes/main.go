package main

import (
	"fmt"
	"math"
)

type Shape interface {
	Name() string
	Area() float64
	Perimeter() float64
}

type Circle struct{ R float64 }
type Rect struct{ W, H float64 }
type Triangle struct{ A, B, C float64 }

func (c Circle) Name() string         { return "circle" }
func (c Circle) Area() float64        { return math.Pi * c.R * c.R }
func (c Circle) Perimeter() float64   { return 2 * math.Pi * c.R }
func (r Rect) Name() string           { return "rect" }
func (r Rect) Area() float64          { return r.W * r.H }
func (r Rect) Perimeter() float64     { return 2 * (r.W + r.H) }
func (t Triangle) Name() string       { return "triangle" }
func (t Triangle) Perimeter() float64 { return t.A + t.B + t.C }
func (t Triangle) Area() float64 {
	p := (t.A + t.B + t.C) / 2
	return math.Sqrt(p * (p - t.A) * (p - t.B) * (p - t.C))
}

func main() {
	shapes := []Shape{Circle{1.0}, Rect{3.0, 4.0}, Triangle{3.0, 4.0, 5.0}}
	for _, s := range shapes {
		fmt.Printf("%s: area=%.2f perimeter=%.2f\n", s.Name(), s.Area(), s.Perimeter())
	}
	largest := shapes[0]
	total := 0.0
	for _, s := range shapes {
		if s.Area() > largest.Area() {
			largest = s
		}
		total += s.Area()
	}
	fmt.Printf("largest: %s\n", largest.Name())
	fmt.Printf("total area: %.2f\n", total)
}
