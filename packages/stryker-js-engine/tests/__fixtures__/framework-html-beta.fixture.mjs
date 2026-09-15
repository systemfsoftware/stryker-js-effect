import { claim, frameworkPlugin } from './framework-service.mjs'

export const strykerPlugins = [frameworkPlugin('html-beta', claim('html', ['.html']))]

export const strykerIgnorers = [{ name: 'beta-ignorer', shouldIgnore: () => 'beta reason' }]
