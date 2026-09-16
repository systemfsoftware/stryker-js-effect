import { parse, preprocess, walk } from './peer-svelte-floor.mjs'

const VERSION = '5.0.0'

const compiler = { VERSION, parse, preprocess, walk }

export default compiler
export { compiler as 'module.exports' }
