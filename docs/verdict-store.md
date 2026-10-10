# Verdict store

A mutation run stores each verdict it settles as one entry in a verdict store, and reads the store before testing to reuse verdicts whose inputs have not changed. The `verdictStore` option picks the store: `{ kind: 'fs', directory }` (the default, `reports/stryker-verdicts`) or `{ kind: 's3', bucket, prefix, region?, endpoint?, forcePathStyle?, connectionTimeoutMs?, requestTimeoutMs? }`, which needs `@systemfsoftware/stryker-js-verdict-store-s3` installed beside the CLI. An S3 request that cannot connect within `connectionTimeoutMs` (default 3000) or gets no response within `requestTimeoutMs` (default 30000) fails as unavailable instead of waiting.

## How entries are named

An entry's name is a digest of every input that can change its verdict:

- the engine digest (the installed files of the engine packages, the lockfile and the Node major)
- the run-inputs digest (the options that change behaviour)
- the mutant-set policy
- the mutant: its id, file name, file content digest, mutator, location and replacement digest
- for a tested verdict: the covering tests' ids, the import-closure digest of their files, and the checker configuration digest
- for a CompileError verdict: the checker's program digest

Nothing in the name refers to a shard, branch, report path or machine. Two runs whose inputs are identical compute the same name, so parallel shards, later runs and other pull requests that share a store reuse each other's verdicts. An entry whose inputs differ has a different name and is never read as a match. Entries written under another key scheme sit in another directory and are invisible.

## Writes and readers

- **fs**: each entry is written to a temporary file, synced, and renamed over its final name. A killed writer leaves either the old entry, the new entry, or a stray temporary file that readers ignore.
- **s3**: each entry is one object, written with a single put. A reader sees a whole object or none.
- An entry that cannot be decoded (torn, foreign, or stored under another verdict's name) is reported as unreadable and counted as `entryUnreadable`. The mutant is tested again; the run never fails on it.
- When several writers store the same name at once, the last write wins. Every writer computed that name from identical inputs, so any surviving entry is a valid verdict for it.
- When a mutant has entries under several current names, the newest one (by `settledAt`) is used, whatever its kind.
- A store that cannot be reached when the run starts stops the run at prepare. A read that fails later is counted as `storeUnavailable` and the mutant is tested again. A write that fails is skipped and counted, and the run ends with a warning naming how many verdicts were not stored.

## Known limits

- **Clock skew.** "Newest entry wins" compares `settledAt`, which is the clock of the machine that settled the verdict. On a store shared by machines whose clocks disagree, the older verdict can win. Both verdicts were computed from the same inputs, so the result is still a valid verdict for them; only the choice between them depends on the clocks.
- **No directory sync on fs.** The fs driver syncs the entry file before the rename but does not sync the parent directory afterwards. A process kill cannot lose an entry, but a host crash or power loss just after the rename can. A lost entry is a miss: the mutant is tested again on the next run.
- **No pruning.** Nothing deletes entries. Every change to a mutant's inputs adds a new entry under a new name, so a long-lived store keeps growing, and listing a mutant's entries gets slower as its history grows. Delete the store directory or S3 prefix to start over; the next run rebuilds it.
