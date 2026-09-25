## 7.2.0

### Patch Changes

- Mutant runs now execute the tests that cover the mutant and report the verdict those tests earn. With the default `related` option, every mutant run filtered out all test files, so mutants came back as errors (`No test files found`) instead of killed or survived. Mutants covered only by tests inside `describe` blocks — any depth, including `describe.each` — now run exactly those covering tests and are reported Killed when any of them fails; mutants covered only by top-level tests keep their existing selection and verdicts.
