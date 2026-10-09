class BankError extends Error {}

interface Account {
  id: number;
  owner: string;
  balance: number;
}

function deposit(a: Account, amount: number): void {
  if (amount <= 0) throw new BankError("deposit must be positive");
  a.balance += amount;
}

function withdraw(a: Account, amount: number): void {
  if (amount <= 0) throw new BankError("withdrawal must be positive");
  if (amount > a.balance) {
    throw new BankError(`insufficient funds: balance ${a.balance}, requested ${amount}`);
  }
  a.balance -= amount;
}

function transfer(src: Account, dst: Account, amount: number): void {
  withdraw(src, amount);
  deposit(dst, amount);
}

const alice: Account = { id: 1, owner: "alice", balance: 100 };
const bob: Account = { id: 2, owner: "bob", balance: 0 };
for (const amount of [30, 200, -5]) {
  try {
    transfer(alice, bob, amount);
    console.log(`transferred ${amount}`);
  } catch (e) {
    if (!(e instanceof BankError)) throw e;
    console.log(`transfer of ${amount} failed: ${e.message}`);
  }
}
console.log(`alice: ${alice.balance}, bob: ${bob.balance}`);
