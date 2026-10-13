# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Incremental reuse

### Import closure

The set of project files a test file can reach through its imports, used to decide whether that test file's earlier results still hold.

A closure is closed when every import in it led to a project file or to something outside the project, such as a Node builtin or an installed dependency. It is open when some import could not be followed or some file could not be parsed. An open closure cannot bound what its test file depends on, so it counts every project file as a dependency.

### Closure digest

A hash over the contents of the files in a test file's import closure. An incremental run reuses a test file's earlier results while its closure digest is unchanged. The digest of an open closure also covers every project file, so an edit anywhere in the project changes it.
