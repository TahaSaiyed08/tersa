package main

import (
	"cmp"
	"fmt"
	"strconv"
	"strings"
)

type Tree[T cmp.Ordered] struct {
	Left  *Tree[T]
	Value T
	Right *Tree[T]
}

func insert[T cmp.Ordered](t *Tree[T], v T) *Tree[T] {
	if t == nil {
		return &Tree[T]{Value: v}
	}
	if v < t.Value {
		return &Tree[T]{insert(t.Left, v), t.Value, t.Right}
	}
	if v > t.Value {
		return &Tree[T]{t.Left, t.Value, insert(t.Right, v)}
	}
	return t
}

func toList[T cmp.Ordered](t *Tree[T]) []T {
	if t == nil {
		return nil
	}
	out := append(toList(t.Left), t.Value)
	return append(out, toList(t.Right)...)
}

func height[T cmp.Ordered](t *Tree[T]) int {
	if t == nil {
		return 0
	}
	return 1 + max(height(t.Left), height(t.Right))
}

func contains[T cmp.Ordered](t *Tree[T], v T) bool {
	if t == nil {
		return false
	}
	if v == t.Value {
		return true
	}
	if v < t.Value {
		return contains(t.Left, v)
	}
	return contains(t.Right, v)
}

func main() {
	var t *Tree[int]
	for _, v := range []int{50, 30, 70, 20, 40, 60, 80, 30} {
		t = insert(t, v)
	}
	var parts []string
	for _, v := range toList(t) {
		parts = append(parts, strconv.Itoa(v))
	}
	fmt.Println(strings.Join(parts, " "))
	fmt.Printf("height: %d, has 60: %t, has 65: %t\n", height(t), contains(t, 60), contains(t, 65))
	var words *Tree[string]
	for _, w := range strings.Fields("pear apple fig") {
		words = insert(words, w)
	}
	fmt.Println(strings.Join(toList(words), " "))
}
