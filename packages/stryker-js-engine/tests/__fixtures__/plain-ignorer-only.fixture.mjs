export const strykerIgnorers = [
  { name: 'plain-fixture-rule', shouldIgnore: () => 'fixture reason' },
  { name: 'plain-fixture-never', shouldIgnore: () => undefined },
]
