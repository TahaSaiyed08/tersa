package main

import (
	"fmt"
	"strconv"
)

func fizzbuzz(n int) string {
	switch {
	case n%15 == 0:
		return "FizzBuzz"
	case n%3 == 0:
		return "Fizz"
	case n%5 == 0:
		return "Buzz"
	default:
		return strconv.Itoa(n)
	}
}

func main() {
	for i := 1; i <= 15; i++ {
		fmt.Println(fizzbuzz(i))
	}
}
