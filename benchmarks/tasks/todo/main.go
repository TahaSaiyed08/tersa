package main

import (
	"fmt"
	"slices"
	"strings"
)

type Task struct {
	ID    int
	Title string
	Done  bool
	Tags  []string
}

var tasks []*Task
var nextID = 1

func add(title string, tags ...string) *Task {
	t := &Task{ID: nextID, Title: title, Tags: tags}
	nextID++
	tasks = append(tasks, t)
	return t
}

func complete(id int) error {
	for _, t := range tasks {
		if t.ID == id {
			if t.Done {
				return fmt.Errorf("task #%d is already done", id)
			}
			t.Done = true
			return nil
		}
	}
	return fmt.Errorf("no task #%d", id)
}

func main() {
	add("write spec", "docs")
	add("build compiler", "code")
	add("publish to npm", "release", "code")
	if err := complete(2); err != nil {
		panic(err)
	}
	for _, id := range []int{2, 9} {
		if err := complete(id); err != nil {
			fmt.Printf("error: %v\n", err)
		} else {
			fmt.Println("ok")
		}
	}

	done, codeLeft := 0, 0
	for _, t := range tasks {
		mark := " "
		if t.Done {
			mark = "x"
			done++
		} else if slices.Contains(t.Tags, "code") {
			codeLeft++
		}
		fmt.Printf("[%s] #%d %s (%s)\n", mark, t.ID, t.Title, strings.Join(t.Tags, ", "))
	}
	fmt.Printf("%d/%d done, %d code task(s) left\n", done, len(tasks), codeLeft)
}
