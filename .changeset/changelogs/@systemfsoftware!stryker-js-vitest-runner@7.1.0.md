## 7.1.0

### Minor Changes

- A finite mutant is killed or survived from its tests. Timeout is reserved for one named nonterminating trap, detected by a hit bound rather than a wall-clock budget. A wall-clock timeout fails the run instead of being stored as a detected mutant.

### Patch Changes

- Mutants that execute far past their dry-run hit count now fail at the hit limit instead of waiting out the test timeout. Coverage from the dry run is recorded again, so the limit is armed.
