import { claim, frameworkPlugin } from './framework-service.mjs'

export const strykerPlugins = [frameworkPlugin('determinism-html-beta', claim('html-beta', ['.html']))]
