# Token benchmark

Eight small programs (fizzbuzz, word frequency, shapes, bank transfers, CSV report, inventory, binary tree, todo list), each written idiomatically in every language and verified to print byte-identical output.

## Totals

| Language | Tokens (o200k) | vs Tersa | Tokens (cl100k) | vs Tersa | Non-blank lines |
|---|---:|---:|---:|---:|---:|
| Tersa | 1976 | - | 1973 | - | 162 |
| Python | 2100 | +6% | 2095 | +6% | 244 |
| Python (typed) | 2384 | +21% | 2381 | +21% | 251 |
| TypeScript | 2472 | +25% | 2463 | +25% | 240 |
| Go | 2895 | +47% | 2886 | +46% | 390 |
| Java | 3127 | +58% | 3073 | +56% | 327 |

## Per task (o200k tokens)

| Task | Tersa | Python | Python (typed) | TypeScript | Go | Java |
|---|---:|---:|---:|---:|---:|---:|
| bank | 226 | 234 | 257 | 288 | 307 | 365 |
| csv_report | 351 | 383 | 412 | 467 | 541 | 540 |
| fizzbuzz | 69 | 76 | 81 | 86 | 102 | 109 |
| inventory | 288 | 307 | 327 | 393 | 462 | 476 |
| shapes | 286 | 336 | 373 | 377 | 424 | 418 |
| todo | 290 | 319 | 345 | 326 | 387 | 437 |
| tree | 366 | 343 | 471 | 389 | 458 | 592 |
| word_freq | 100 | 102 | 118 | 146 | 214 | 190 |

Tokenizers: OpenAI o200k_base and cl100k_base via the `gpt-tokenizer` package. Not every model's tokenizer is public, so treat these as a proxy; relative differences are what matter.

Reproduce: `npm run bench` (counts) and `bash benchmarks/verify.sh` (checks every version prints the same output).
