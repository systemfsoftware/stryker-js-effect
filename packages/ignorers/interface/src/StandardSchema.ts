import type { StandardSchemaV1 } from '@standard-schema/spec'

export interface Schema<Output> extends StandardSchemaV1<unknown, Output> {}

export type TypeOf<S> = S extends Schema<infer Output> ? Output : never

type Guard<Output> = (value: unknown) => value is Output
type Check = (value: unknown) => boolean
type Field = { readonly key: string; readonly check: Check }
type Shape = Readonly<Record<string, Schema<unknown>>>
type StructOutput<S extends Shape> = { [K in keyof S]: TypeOf<S[K]> }
type UnionOutput<Members extends ReadonlyArray<Schema<unknown>>> = TypeOf<Members[number]>

export const VENDOR = '@systemfsoftware/stryker-ignorer-interface'

export const DEFAULT_MAX_DEPTH = 6

const checks = new WeakMap<object, Check>()

const publish = <Output>(guard: Guard<Output>, message: string): Schema<Output> => {
  const schema: Schema<Output> = {
    '~standard': {
      version: 1,
      vendor: VENDOR,
      types: undefined,
      validate: (value) => (guard(value) ? { value } : { issues: [{ message }] }),
    },
  }
  checks.set(schema, guard)
  return schema
}

const sync = <Output>(
  result: StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>,
): StandardSchemaV1.Result<Output> => {
  if (result instanceof Promise) {
    throw new Error(`${VENDOR}: validate() returned a promise; the toolkit composes synchronous validators only`)
  }
  return result
}

export const validate = <Output>(schema: Schema<Output>, value: unknown): StandardSchemaV1.Result<Output> =>
  sync(schema['~standard'].validate(value))

export const is = <Output>(schema: Schema<Output>, value: unknown): value is Output =>
  validate(schema, value).issues === undefined

const fromValidate = (schema: Schema<unknown>): Check => (value) => validate(schema, value).issues === undefined

const checkOf = (schema: Schema<unknown>): Check => checks.get(schema) ?? fromValidate(schema)

const isObjectValue = (value: unknown): value is object => typeof value === 'object' && value !== null

const isArray = (value: unknown): value is ReadonlyArray<unknown> => Array.isArray(value)

const refine =
  <Output>(guard: Guard<Output>, extra: (value: Output) => boolean): Guard<Output> => (value): value is Output =>
    guard(value) && extra(value)

const hasItems = (values: ReadonlyArray<unknown>): boolean => values.length > 0

export const string = (): Schema<string> =>
  publish((value): value is string => typeof value === 'string', 'Expected a string')

export const literal = <V extends string | number | boolean>(expected: V): Schema<V> =>
  publish((value): value is V => value === expected, `Expected the literal "${String(expected)}"`)

export const unknown = (): Schema<unknown> =>
  publish((value): value is unknown => value === undefined || typeof value !== 'undefined', 'Never fails')

export const declared = <Output>(predicate: Guard<Output>): Schema<Output> =>
  publish(predicate, 'The declared predicate rejected the value')

const arrayGuard = <Output>(element: Schema<Output>): Guard<ReadonlyArray<Output>> => {
  const check = checkOf(element)
  const everyItem = (values: ReadonlyArray<unknown>): boolean => values.every(check)
  return (value): value is ReadonlyArray<Output> => isArray(value) && everyItem(value)
}

export const array = <Output>(element: Schema<Output>): Schema<ReadonlyArray<Output>> =>
  publish(arrayGuard(element), 'Expected an array')

export const nonEmptyArray = <Output>(element: Schema<Output>): Schema<ReadonlyArray<Output>> =>
  publish(refine(arrayGuard(element), hasItems), 'Expected a non-empty array')

export const optional = <Output>(schema: Schema<Output>): Schema<Output | undefined> => {
  const check = checkOf(schema)
  return publish(
    (value): value is Output | undefined => value === undefined || check(value),
    'Expected the declared value or nothing',
  )
}

export const nullable = <Output>(schema: Schema<Output>): Schema<Output | null> => {
  const check = checkOf(schema)
  return publish(
    (value): value is Output | null => value === null || check(value),
    'Expected the declared value or null',
  )
}

const fieldValue = (value: object, key: string): unknown => (value as Record<string, unknown>)[key]

const fieldsOf = (shape: Shape): ReadonlyArray<Field> =>
  Object.entries(shape).map(([key, schema]) => ({ key, check: checkOf(schema) }))

const shapeHolds = (fields: ReadonlyArray<Field>, value: object): boolean =>
  fields.every((field) => field.check(fieldValue(value, field.key)))

export const struct = <S extends Shape>(shape: S): Schema<StructOutput<S>> => {
  const fields = fieldsOf(shape)
  return publish(
    (value): value is StructOutput<S> => isObjectValue(value) && shapeHolds(fields, value),
    'Expected an object matching the declared keys',
  )
}

export const union = <Members extends ReadonlyArray<Schema<unknown>>>(
  members: Members,
): Schema<UnionOutput<Members>> => {
  const memberChecks = members.map(checkOf)
  return publish(
    (value): value is UnionOutput<Members> => memberChecks.some((check) => check(value)),
    'Value did not match any member of the union',
  )
}

export const literals = <V extends readonly string[]>(values: V): Schema<V[number]> =>
  union(values.map((value) => literal(value)))

const budgeted = <Output>(thunk: () => Schema<Output>, maxDepth: number): Guard<Output> => {
  let depth = 0
  return (value): value is Output => {
    depth += 1
    try {
      return depth <= maxDepth && checkOf(thunk())(value)
    } finally {
      depth -= 1
    }
  }
}

const depthBudget = (options: { readonly maxDepth?: number }): number => options.maxDepth ?? DEFAULT_MAX_DEPTH

export const suspend = <Output>(
  thunk: () => Schema<Output>,
  options: { readonly maxDepth?: number } = {},
): Schema<Output> => {
  const maxDepth = depthBudget(options)
  return publish(budgeted(thunk, maxDepth), `Exceeded the recursion budget of ${maxDepth}`)
}
