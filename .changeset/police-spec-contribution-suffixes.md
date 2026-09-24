---
"@systemfsoftware/stryker-test-contribution": minor
---

Differential, conformance, and trace specification files are now policed, so a specification that kills nothing another test file does not also kill fails the mutation run by name.

- Test files named for the differential, conformance, and trace specifications join the workflow, policy, and kernel property files the plugin already policed.
- A specification that kills a mutant no other test file kills passes unchanged, and the property-file verdict wording and rules are untouched.
