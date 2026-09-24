import { StrykerConfig } from '../src/config/stryker-config.schema.js'
console.log(JSON.stringify(StrykerConfig.merge({} , JSON.parse('{"__proto__":0}'))));
console.log(JSON.stringify(StrykerConfig.merge({"toString":null}, {})));
console.log(JSON.stringify(StrykerConfig.merge(JSON.parse('{"toString":null}'), JSON.parse('{"toString":null}'))));
console.log(JSON.stringify(StrykerConfig.merge({a:1,b:{c:2}}, {b:{d:3},e:4})));
console.log(JSON.stringify(StrykerConfig.merge({a:{b:[1]}}, {a:{b:[2]}})));
console.log(JSON.stringify(StrykerConfig.merge({a:1},{a:2})));
