# AI-bug benchmark

Each case is a mistake LLMs commonly make, written as typed Python (so mypy has a fair chance) and as the equivalent Tersa.

| Bug | Plain Python | mypy --strict | Tersa |
|---|---|---|---|
| accidental mutation | runs, wrong result | missed | caught (E121: can't assign to 'limits': it is immutable, and it is the same object as 'DEFAULT_LIMITS') |
| compare str int | crashes at runtime | caught | caught (E110: can't compare str >= int) |
| discarded result | runs, wrong result | missed | caught (E141: the result of 'trim' is discarded; trim() returns a new value and doesn't change anything) |
| ignored error | crashes at runtime | caught | caught (E140: 'port' may be none, so '+' isn't safe) |
| late binding | runs, wrong result | missed | prevented by design (correct output) |
| missing case | runs, wrong result | missed | caught (E130: match is not exhaustive: missing Voucher(_)) |
| missing return | crashes at runtime | caught | caught (E150: function 'grade' must return str, but its body can end without a value) |
| mutable default | runs, wrong result | missed | prevented by design (correct output) |
| none deref | crashes at runtime | caught | caught (E140: 'name' may be none, so calling .upper() isn't safe) |
| str plus int | crashes at runtime | caught | caught (E110: can't add str and int) |
| truthiness | runs, wrong result | missed | caught (E170: if condition needs a bool, but this is float?) |
| unchecked parse | crashes at runtime | missed | caught (E110: int() converts numbers; to parse text use parse_int(s), which returns int? (none if the text isn't a number)) |
| wrong arg order | crashes at runtime | caught | caught (E110: argument 'amount' of transfer() should be float, but it is str) |

**Caught or prevented before running:** Python 0/13, mypy --strict 6/13, Tersa 13/13.

Plain Python silently produced a wrong result in 6 of 13 cases.

Reproduce: `npm run bench:bugs` (needs python3; mypy optional: `pip install mypy`).
