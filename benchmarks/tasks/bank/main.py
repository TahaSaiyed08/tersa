from dataclasses import dataclass


class BankError(Exception):
    pass


@dataclass
class Account:
    id: int
    owner: str
    balance: int = 0


def deposit(a, amount):
    if amount <= 0:
        raise BankError("deposit must be positive")
    a.balance += amount


def withdraw(a, amount):
    if amount <= 0:
        raise BankError("withdrawal must be positive")
    if amount > a.balance:
        raise BankError(f"insufficient funds: balance {a.balance}, requested {amount}")
    a.balance -= amount


def transfer(src, dst, amount):
    withdraw(src, amount)
    deposit(dst, amount)


alice = Account(1, "alice", 100)
bob = Account(2, "bob")
for amount in [30, 200, -5]:
    try:
        transfer(alice, bob, amount)
        print(f"transferred {amount}")
    except BankError as e:
        print(f"transfer of {amount} failed: {e}")
print(f"alice: {alice.balance}, bob: {bob.balance}")
