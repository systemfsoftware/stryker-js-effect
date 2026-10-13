import { increment } from './annotated.js'
import { Box } from './box.js'
import { identity } from './closer.js'
import { Counter } from './constructed.js'
import { step } from './contextual.js'
import { greet } from './defaults.js'
import { double } from './inferred.js'
import { Store } from './stored.js'

export const incremented: number = increment(1)
export const doubled: number = double(1)
greet(2)
export const same: number = identity(1)
export const stepped: number = step(1)
export const count: number = new Box().size
export const start: number = new Counter().start
const store = new Store()
store.value = 2
export const stored: number = store.value
