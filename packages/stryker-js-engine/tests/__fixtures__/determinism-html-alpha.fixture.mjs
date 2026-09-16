import { claim, frameworkPlugin } from './framework-service.mjs'

export const strykerPlugins = [frameworkPlugin('determinism-html-alpha', claim('html-alpha', ['.html']))]
