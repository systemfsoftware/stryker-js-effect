import { claim, frameworkPlugin } from './framework-service.mjs'

export const strykerPlugins = [frameworkPlugin('version-fixture', claim('html', ['.html'], '2'))]
