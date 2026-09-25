---
'@systemfsoftware/stryker-js-typescript-checker': patch
---

The checker no longer looks dead while it type-checks. A check that runs longer than the host's connection patience window used to leave the checker unable to answer the host, dropping its connection mid-run; long checks are now answered and the connection survives them.
