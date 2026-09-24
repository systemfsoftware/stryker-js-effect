# Contributing

Contributions are welcome. Follow these instructions to set up the development environment, run tests, and open pull requests.

## Prerequisites

- [Node.js](https://nodejs.org/) `>=24`
- [pnpm](https://pnpm.io/) `>=11.21.0` (the `packageManager` field pins the exact version; Corepack resolves it)

## Setup

Clone the repository and install dependencies:

```bash
git clone <your-repo-url>
cd <your-repo>
pnpm install
```

## Workflows and Commands

The project uses [Turbo](https://turbo.build/) to orchestrate tasks across workspaces:

```bash
# Build all packages
pnpm build

# Run unit and integration tests
pnpm test

# Typecheck workspace packages
pnpm typecheck

# Check code formatting with dprint
pnpm format:check

# Format files with dprint
pnpm format

# Run linter across packages
pnpm lint

# Run all CI gates locally
pnpm check:ci
```

## Pull Requests & Commits

- We follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(cli): ...`, `fix(core): ...`).
- Ensure all CI gates (`pnpm check:ci`) pass locally before opening a pull request.

## Extending Stryker

Authoring guides ship with the repository under `skills/stryker-mutation-testing/references/`:

- [Mutation Testing Decision Guide](skills/stryker-mutation-testing/references/decision-guide.md) — choose between the in-memory V8 VM, Vitest worker sandboxes, and the shell command runner.
- [Authoring Custom Ignorers](skills/stryker-mutation-testing/references/authoring-ignorers.md) — write custom AST visitors with `@systemfsoftware/stryker-ignorer-kit`.
- [Authoring Custom Test Runners](skills/stryker-mutation-testing/references/authoring-runners.md) — build test runner worker plugins with `@systemfsoftware/stryker-js-plugin-interface`.
