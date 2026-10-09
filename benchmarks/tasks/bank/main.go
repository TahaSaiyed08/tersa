package main

import (
	"errors"
	"fmt"
)

type Account struct {
	ID      int
	Owner   string
	Balance int
}

func deposit(a *Account, amount int) error {
	if amount <= 0 {
		return errors.New("deposit must be positive")
	}
	a.Balance += amount
	return nil
}

func withdraw(a *Account, amount int) error {
	if amount <= 0 {
		return errors.New("withdrawal must be positive")
	}
	if amount > a.Balance {
		return fmt.Errorf("insufficient funds: balance %d, requested %d", a.Balance, amount)
	}
	a.Balance -= amount
	return nil
}

func transfer(src, dst *Account, amount int) error {
	if err := withdraw(src, amount); err != nil {
		return err
	}
	return deposit(dst, amount)
}

func main() {
	alice := &Account{1, "alice", 100}
	bob := &Account{2, "bob", 0}
	for _, amount := range []int{30, 200, -5} {
		if err := transfer(alice, bob, amount); err != nil {
			fmt.Printf("transfer of %d failed: %v\n", amount, err)
		} else {
			fmt.Printf("transferred %d\n", amount)
		}
	}
	fmt.Printf("alice: %d, bob: %d\n", alice.Balance, bob.Balance)
}
