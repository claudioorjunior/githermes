# Contributing

Thanks for helping! This is an early-stage plugin — bugs are expected and
collaboration is very welcome. These rules mirror the conventions of the
[Hermes Agent repo](https://github.com/NousResearch/hermes-agent/blob/main/CONTRIBUTING.md).

## Before you start

- Search open **and** closed issues/PRs first — duplicates are common.
- Comment on an issue before starting large work, so effort isn't doubled.
- This repo is plugin-only: changes must live in the plugin
  (`desktop/plugin.js`, `plugin.yaml`). Never assume changes to the Hermes
  Desktop core are possible — if a capability is missing from the plugin
  surface, open an issue instead.

## Pull requests

1. Branch naming: `fix/description`, `feat/description`, `docs/description`.
2. One logical change per PR — don't mix a fix with a refactor with a feature.
3. Use [Conventional Commits](https://www.conventionalcommits.org/):
   `fix: …`, `feat: …`, `docs: …`, `refactor: …`, `chore: …`.
4. Test manually: load the plugin in Hermes Desktop and exercise the path you
   changed. State what you tested and on which OS in the PR description.
5. PR description: **what** changed, **why**, **how to test**, related issues.

## Reporting issues

Include: OS, Hermes Desktop version, plugin version/commit, and steps to
reproduce. For security vulnerabilities, report privately (Security tab)
instead of opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
