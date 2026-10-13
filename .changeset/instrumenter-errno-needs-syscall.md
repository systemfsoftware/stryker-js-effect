---
"@systemfsoftware/stryker-js-instrumenter": patch
---

`ErrorText.errorTextOf` uses the errno format (`<name>: <code> (<syscall>) <stack>`) only when the error carries both a string `code` and a string `syscall`. An error that has a `code` but no `syscall` now renders as `<name>: <message>` followed by its stack, instead of `<name>: <code> (undefined) <stack>`. This covers Node's `ERR_*` errors and tagged errors that expose a reason `code`.
