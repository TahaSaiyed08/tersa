package main

import (
	"fmt"
	"sort"
	"strings"
)

func main() {
	text := `the quick brown fox jumps over the lazy dog
the dog barks and the fox runs away quick`

	counts := map[string]int{}
	for _, word := range strings.Fields(strings.ToLower(text)) {
		counts[word]++
	}

	type kv struct {
		word string
		n    int
	}
	var pairs []kv
	for w, n := range counts {
		pairs = append(pairs, kv{w, n})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].n != pairs[j].n {
			return pairs[i].n > pairs[j].n
		}
		return pairs[i].word < pairs[j].word
	})
	for _, p := range pairs[:3] {
		fmt.Printf("%s: %d\n", p.word, p.n)
	}
	fmt.Printf("unique words: %d\n", len(counts))
}
