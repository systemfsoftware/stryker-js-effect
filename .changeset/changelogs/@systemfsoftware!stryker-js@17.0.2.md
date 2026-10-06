## 17.0.2

### Patch Changes

- A shard plan now prices only the mutants a run will actually execute: mutants the incremental cache will reuse are planned at zero cost instead of their previous run time, so an unchanged project plans a single shard with zero predicted seconds. The plan still lists every mutant, so sharded runs keep reporting the full mutant set.

- A merged shard report now carries the cost record of every shard, so a later plan sees measured timings for all mutants. Previously only the first shard's costs survived the merge, and the mutants of every other shard fell back to their predicted cost whenever the next plan was derived.
