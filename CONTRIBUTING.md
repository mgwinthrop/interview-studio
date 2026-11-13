# Contributing

Thanks for helping. The full guide is [docs/contributing.md](docs/contributing.md). In short:

1. Fork the repo and create a branch.
2. Run the whole app keylessly with `PROFILE=mock` (see the [README](README.md#quick-start)).
3. Keep changes small and focused.
4. Run the checks: `npm test`, `npm --prefix apps/frontend run lint`, `npm --prefix apps/frontend run build`, `npm --prefix apps/backend run build`. CI runs the same ones.
5. Confirm your diff has no credentials, session data, databases or deployment details.
6. Open a pull request.

By contributing you agree that your work is released under the [MIT License](LICENSE).

Security problems: use [private reporting](SECURITY.md), not a public issue. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
