import { claim, pluginWithService, serviceOf } from './framework-service.mjs'

const malformed = { ...serviceOf(claim('html', ['.html'])), parse: 'not a function' }

export const strykerPlugins = [pluginWithService('malformed-fixture', malformed)]
