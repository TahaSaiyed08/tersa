package main

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type Sale struct {
	Region, Product string
	Units           int
	Price           float64
}

func parseLine(line string, n int) (Sale, error) {
	cols := strings.Split(line, ",")
	if len(cols) != 4 {
		return Sale{}, fmt.Errorf("line %d: expected 4 columns, got %d", n, len(cols))
	}
	units, err := strconv.Atoi(strings.TrimSpace(cols[2]))
	if err != nil {
		return Sale{}, fmt.Errorf("line %d: bad units '%s'", n, cols[2])
	}
	price, err := strconv.ParseFloat(strings.TrimSpace(cols[3]), 64)
	if err != nil {
		return Sale{}, fmt.Errorf("line %d: bad price '%s'", n, cols[3])
	}
	return Sale{strings.TrimSpace(cols[0]), strings.TrimSpace(cols[1]), units, price}, nil
}

func main() {
	data := `region,product,units,price
west,widget,10,2.50
east,gadget,3,10.00
west,gadget,oops,10.00
east,widget,7,2.50
north,widget,1
west,widget,5,2.50`

	var sales []Sale
	var errs []string
	for i, line := range strings.Split(data, "\n")[1:] {
		s, err := parseLine(line, i+2)
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		sales = append(sales, s)
	}

	byRegion := map[string][]Sale{}
	for _, s := range sales {
		byRegion[s.Region] = append(byRegion[s.Region], s)
	}
	regions := make([]string, 0, len(byRegion))
	for r := range byRegion {
		regions = append(regions, r)
	}
	sort.Strings(regions)
	for _, r := range regions {
		rows := byRegion[r]
		revenue := 0.0
		for _, s := range rows {
			revenue += float64(s.Units) * s.Price
		}
		fmt.Printf("%s: %d sales, revenue %.2f\n", r, len(rows), revenue)
	}
	fmt.Printf("skipped %d bad lines:\n", len(errs))
	for _, e := range errs {
		fmt.Printf("  %s\n", e)
	}
}
