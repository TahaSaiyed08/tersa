# Publishing Tersa

The package name `tersa` was free on npm when this was written (2026-10-09). Check again with `npm view tersa` before publishing; if it's taken, change `"name"` in `package.json` (for example to `tersa-lang`).

## 1. Push to GitHub

1. Create an empty repository named `tersa` at https://github.com/new (no README or license; the project has them).
2. From the project folder:

```
git remote add origin https://github.com/smta08/tersa.git
git branch -M main
git push -u origin main
```

CI (`.github/workflows/ci.yml`) runs the tests on Node 18/20/22 with Python 3.10/3.13, and re-verifies the benchmarks.

## 2. Publish to npm

1. Create an account at https://www.npmjs.com/signup and turn on two-factor authentication.
2. Then:

```
npm login
npm publish --dry-run   # shows exactly which files will be published
npm publish
```

`prepublishOnly` builds the compiler and runs the full test suite first, so a broken build can't be published.

After publishing, anyone can install it with `npm install -g tersa`.

## 3. Release new versions

```
npm version patch    # 0.1.0 -> 0.1.1 (use minor/major for bigger changes)
git push --follow-tags
npm publish
```

Add an entry to `CHANGELOG.md` for each release.

## 4. Optional: VS Code extension

```
cd editors/vscode
npx @vscode/vsce package     # creates tersa-lang-0.1.0.vsix
```

To publish it on the Marketplace, create a publisher at https://marketplace.visualstudio.com/manage and run `npx @vscode/vsce publish`.

## 5. Tell people

- Put the benchmark tables from the README in your post; the claims are reproducible with `npm run bench` and `npm run bench:bugs`.
- Good places: r/ProgrammingLanguages, Hacker News (Show HN), and the LLM/AI-engineering communities.
- Invite people to try the loop: paste `tersa spec` into a model, generate code, and run `tersa check --json`.
