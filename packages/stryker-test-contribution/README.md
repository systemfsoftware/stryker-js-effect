# @systemfsoftware/stryker-test-contribution

Fails a mutation run when a required test file kills no mutant that another test file does not also kill.

Listing the plugin in `plugins` turns the check on. There is no option to set and no reporter to add.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-test-contribution
```

## Configure

```json
{
  "plugins": ["@systemfsoftware/stryker-test-contribution"]
}
```

The gate polices `.workflow.property.test.ts`, `.policy.property.test.ts`, `.kernel.property.test.ts`, `.differential.test.ts`, `.conformance.test.ts`, and `.trace.test.ts` files. A differential, conformance, or trace spec earns its place the same way a property file does: it must kill a mutant no other test file kills. To turn the check off, remove the plugin from `plugins`.
