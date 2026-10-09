from dataclasses import dataclass

@dataclass
class Card:
    last4: str

@dataclass
class Cash:
    pass

@dataclass
class Voucher:
    code: str

Payment = Card | Cash | Voucher

def fee(p: Payment) -> float:
    match p:
        case Card():
            return 0.3
        case Cash():
            return 0.0
    return 0.0  # Voucher added later; silently treated as free

print(fee(Voucher("X1")))
