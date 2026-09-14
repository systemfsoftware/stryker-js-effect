import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'

export const strykerPlugins = [declarePlugin('Reporter', 'native-fixture-reporter', () => ({}))]
export const strykerIgnorers = [{ name: 'plain-fixture-rule', shouldIgnore: () => 'plain reason' }]
