## 11.1.0

### Minor Changes

- The new `surfacing` option (default `{ perLine: 1, perFile: 7 }`) caps how many survivors are listed per line and per file, while every survivor still counts toward the score.

### Patch Changes

- Fixed mutant coverage whose hit counts were keyed by anything other than a mutant id being silently emptied on decode — such a payload now fails validation, so a mismatched runner/plugin pair reports the key mismatch instead of planning every mutant as uncovered.
