package main

import (
	"fmt"
	"sort"
	"strings"
)

type Item struct {
	Name   string
	Qty    int
	MinQty int
	Price  float64
}

var stock = map[string]*Item{}
var order []string

func sell(name string, n int) error {
	item, ok := stock[name]
	if !ok {
		return fmt.Errorf("unknown item %s", name)
	}
	if item.Qty < n {
		return fmt.Errorf("only %d %s left", item.Qty, name)
	}
	item.Qty -= n
	return nil
}

func main() {
	for _, it := range []*Item{{"apple", 50, 20, 0.5}, {"bread", 5, 10, 2.25}, {"milk", 8, 12, 1.2}, {"rice", 30, 5, 3.0}} {
		stock[it.Name] = it
		order = append(order, it.Name)
	}

	sales := []struct {
		name string
		n    int
	}{{"apple", 35}, {"milk", 10}, {"tea", 1}, {"bread", 2}}
	for _, s := range sales {
		if err := sell(s.name, s.n); err != nil {
			fmt.Printf("cannot sell: %v\n", err)
		} else {
			fmt.Printf("sold %d %s\n", s.n, s.name)
		}
	}

	var low []*Item
	value := 0.0
	for _, name := range order {
		it := stock[name]
		if it.Qty < it.MinQty {
			low = append(low, it)
		}
		value += float64(it.Qty) * it.Price
	}
	sort.Slice(low, func(i, j int) bool { return low[i].Qty < low[j].Qty })
	names := make([]string, len(low))
	for i, it := range low {
		names[i] = it.Name
	}
	fmt.Printf("restock: %s\n", strings.Join(names, ", "))
	fmt.Printf("stock value: %.2f\n", value)
}
