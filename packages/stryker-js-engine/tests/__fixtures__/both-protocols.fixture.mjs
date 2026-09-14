import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'

const standardSchema = {
  '~standard': {
    version: 1,
    vendor: 'fixture',
    /** @param {unknown} value */
    validate: (value) => ({ value }),
  },
}

export const strykerPlugins = [declarePlugin('Reporter', 'native-fixture-reporter', () => ({}))]
export const strykerIgnorers = [{
  name: 'plain-fixture-rule',
  schema: standardSchema,
  shouldIgnore: () => 'plain reason',
}]
