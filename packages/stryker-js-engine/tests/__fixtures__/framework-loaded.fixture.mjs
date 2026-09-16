import { claim, frameworkPlugin } from './framework-service.mjs'

export const strykerPlugins = [frameworkPlugin('framework-fixture', claim('plain', ['.plain']))]
