# Contributing to JARVIS

Thanks for taking a look. Contributions of every size are welcome: bug reports, typo fixes,
docs, new features, data corrections and ideas.

## Ways to help

- **Report a bug or a wrong fact.** Open an issue with what you did, what you expected and what
  happened instead. Screenshots, logs or a source link help a lot.
- **Suggest an idea.** Open an issue describing the problem it solves before writing a lot of code,
  so we can agree on the approach first.
- **Send a fix.** Small, focused pull requests are reviewed fastest.

## Getting set up

```bash
git clone https://github.com/SolutionsAsService/JARVIS
cd JARVIS
npm install
npm run dev
npm run build
npm test
```

## Making a change

1. Fork the repo and create a branch from the default branch: `git checkout -b fix/short-description`.
2. Keep the change focused on one thing, and match the style of the surrounding code.
3. Test what you changed (run it, run the tests if there are any) and note how you checked it.
4. Write a clear commit message in the imperative: `Fix crash when config is missing`.
5. Open a pull request that says what changed and why, and link the issue it closes.

## Pull request checklist

- [ ] The change does one thing and the description explains it.
- [ ] It runs locally, and existing tests still pass.
- [ ] Docs or README are updated if behaviour changed.
- [ ] No secrets, API keys or personal data are committed.

## Conduct

Be kind and constructive. Critique code, not people. Harassment of any kind is not tolerated.

## License

By contributing, you agree that your contributions are licensed under the MIT License of this
repository (see [LICENSE](LICENSE)).
