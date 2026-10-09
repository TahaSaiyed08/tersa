def transfer(amount: float, to_account: str) -> str:
    return f"sent {amount:.2f} to {to_account}"

print(transfer("ACC-42", 100.0))
