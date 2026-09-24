import { mergeConfig } from '../src/config/merge-config.js'
console.log(JSON.stringify(mergeConfig({}, JSON.parse('{"__proto__":0}'))))
console.log(JSON.stringify(mergeConfig({ toString: null }, {})))
console.log(JSON.stringify(mergeConfig(JSON.parse('{"toString":null}'), JSON.parse('{"toString":null}'))))
