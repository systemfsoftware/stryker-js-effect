# @systemfsoftware/stryker-checker-parity

The checker-parity lane's driver, private to this repository. It runs one checker side over a corpus shard, records one NDJSON observation per mutant, and compares the two sides so a checker whose verdict or type-query answer drifts from `main` fails the lane.

## Driver

`src/main.ts` publishes the `checker-parity` CLI:

- `plan --deadline <seconds>` — slices the corpus into shards sized to the leg budget.
- `run` — drives one side of one shard over the corpus and writes `shard-<k>.ndjson` plus `scope-<k>.json`.
- `compare` — decodes every `*.ndjson` under its inputs and decides parity.
- `report` — renders the decision for the lane's checks.
- `costs` — folds recent runs' leg measurements into the cost table.
- `trigger` — decides whether the lane runs for a change.

Every line is the wire language of `src/Parity.schema.ts`; `compare` decodes through `S.fromJsonString(ParityLine)` and hands the lines to the pure `src/compare-sides.workflow.ts`.

## The type-query leg

Beyond the check leg, the branch side drives the branch worker's `capabilities` and `typeQuery` RPCs (`Plugin.CheckerRpcs`) through `src/type-query-side.ts`. Answers land as `TypeAnswerLine` rows, a per-file refusal as `TypeQueryFileRefused`, and a query the leg could not finish as `Deferred`. A worker that does not declare the queried version is refused as `unsupported-version` without a query being sent.

Both legs read one leg budget (`src/leg-deadline.ts`). The type-query leg bounds the handshake and every `typeQuery` call by the leg's remaining budget and, when the budget is already spent, emits `Deferred` for that file without touching the worker.

**That bound applies only to runs given `--deadline`.** `run`'s flag is optional: without it `deadlineAt` is `None`, so every leg — check and type-query alike — runs unbounded. The CI lane's run step passes no `--deadline` (only its `plan` step does), so the bound never fires there and a run is bounded solely where a caller passes the flag.

## Running locally

From this package directory:

```bash
pnpm build
node dist/main.mjs run --help
```

## Tests

Property tests and in-source schema laws run under Vitest:

```bash
pnpm --filter @systemfsoftware/stryker-checker-parity test
```
