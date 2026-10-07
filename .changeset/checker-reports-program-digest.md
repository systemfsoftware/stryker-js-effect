---
"@systemfsoftware/stryker-js-plugin-interface": minor
"@systemfsoftware/stryker-js-typescript-checker": minor
---

A checker plugin can now report the program it loaded. `CheckerService` gains a
`digest` holding the digest of that program, the checker RPC exposes it as
`digest`, and a TypeScript checker answers with the digest of the TypeScript
program it built: the hashed content of every source file the program loaded
(project files, declaration files and the ones TypeScript ships), the tsconfig
files it was built from, the TypeScript version, the checker's own version, and
its configured options. The digest is stable for an unchanged program and moves
when any of those change.
