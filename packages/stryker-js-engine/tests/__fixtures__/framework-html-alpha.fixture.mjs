import { claim, frameworkPlugin } from './framework-service.mjs'

export const strykerPlugins = [frameworkPlugin('html-alpha', claim('html', ['.html']))]

export const strykerIgnorers = [{ name: 'alpha-ignorer', shouldIgnore: () => 'alpha reason' }]
