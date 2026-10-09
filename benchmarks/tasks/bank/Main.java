import java.util.*;

public class Main {
    static class BankException extends Exception {
        BankException(String msg) { super(msg); }
    }

    static class Account {
        final int id;
        final String owner;
        int balance;

        Account(int id, String owner, int balance) {
            this.id = id;
            this.owner = owner;
            this.balance = balance;
        }
    }

    static void deposit(Account a, int amount) throws BankException {
        if (amount <= 0) throw new BankException("deposit must be positive");
        a.balance += amount;
    }

    static void withdraw(Account a, int amount) throws BankException {
        if (amount <= 0) throw new BankException("withdrawal must be positive");
        if (amount > a.balance) {
            throw new BankException("insufficient funds: balance " + a.balance + ", requested " + amount);
        }
        a.balance -= amount;
    }

    static void transfer(Account src, Account dst, int amount) throws BankException {
        withdraw(src, amount);
        deposit(dst, amount);
    }

    public static void main(String[] args) {
        Account alice = new Account(1, "alice", 100);
        Account bob = new Account(2, "bob", 0);
        for (int amount : new int[] {30, 200, -5}) {
            try {
                transfer(alice, bob, amount);
                System.out.println("transferred " + amount);
            } catch (BankException e) {
                System.out.println("transfer of " + amount + " failed: " + e.getMessage());
            }
        }
        System.out.println("alice: " + alice.balance + ", bob: " + bob.balance);
    }
}
