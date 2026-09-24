import { dual } from 'effect/Function'

import type { GlobalValue } from './vm-json.js'

export type GlobalTarget = typeof globalThis

export type DescriptorMap = ReadonlyMap<string, PropertyDescriptor>

export type PriorDescriptors = ReadonlyMap<string, PropertyDescriptor | undefined>

const isObjectValue = (candidate: unknown): candidate is object => typeof candidate === 'object' && candidate !== null

export const captureDescriptors = (target: GlobalTarget): DescriptorMap =>
  new Map(Object.entries(Object.getOwnPropertyDescriptors(target)))

type DescriptorField = 'get' | 'set' | 'value' | 'writable' | 'enumerable' | 'configurable'

const DESCRIPTOR_FIELDS: ReadonlyArray<DescriptorField> = [
  'get',
  'set',
  'value',
  'writable',
  'enumerable',
  'configurable',
]

const fieldMatches = (before: PropertyDescriptor, after: PropertyDescriptor, field: DescriptorField): boolean =>
  field === 'value' ? Object.is(before.value, after.value) : before[field] === after[field]

export const sameDescriptor = dual<
  (after: PropertyDescriptor) => (before: PropertyDescriptor | undefined) => boolean,
  (before: PropertyDescriptor | undefined, after: PropertyDescriptor) => boolean
>(2, (before, after) => before !== undefined && DESCRIPTOR_FIELDS.every((field) => fieldMatches(before, after, field)))

const differingEntries = (
  before: DescriptorMap,
  after: DescriptorMap,
): ReadonlyArray<readonly [string, PropertyDescriptor]> =>
  [...after].filter(([key, descriptor]) => !sameDescriptor(before.get(key), descriptor))

export const installedDescriptors = dual<
  (after: DescriptorMap) => (before: DescriptorMap) => DescriptorMap,
  (before: DescriptorMap, after: DescriptorMap) => DescriptorMap
>(2, (before, after) => new Map(differingEntries(before, after)))

export const priorDescriptors = dual<
  (installed: DescriptorMap) => (before: DescriptorMap) => PriorDescriptors,
  (before: DescriptorMap, installed: DescriptorMap) => PriorDescriptors
>(2, (before, installed) => {
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const key of installed.keys()) originals.set(key, before.get(key))
  return originals
})

export const installDescriptors = dual<
  (descriptors: DescriptorMap) => (target: GlobalTarget) => void,
  (target: GlobalTarget, descriptors: DescriptorMap) => void
>(2, (target, descriptors) => {
  for (const [key, descriptor] of descriptors) Object.defineProperty(target, key, descriptor)
})

const restoreDescriptor = (target: GlobalTarget, key: string, original: PropertyDescriptor | undefined): void => {
  if (original === undefined) {
    Reflect.deleteProperty(target, key)
    return
  }
  Object.defineProperty(target, key, original)
}

export const restoreDescriptors = dual<
  (originals: PriorDescriptors) => (target: GlobalTarget) => void,
  (target: GlobalTarget, originals: PriorDescriptors) => void
>(2, (target, originals) => {
  for (const [key, original] of originals) restoreDescriptor(target, key, original)
})

export const defineGlobalValue = dual<
  (key: string, value: GlobalValue) => (target: object) => void,
  (target: object, key: string, value: GlobalValue) => void
>(3, (target, key, value) => {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
})

const objectValueOf = (value: PropertyDescriptor['value']): object | undefined =>
  isObjectValue(value) ? value : undefined

export const childGlobal = dual<
  (segment: string) => (parent: object) => object | undefined,
  (parent: object, segment: string) => object | undefined
>(2, (parent, segment) => objectValueOf(Object.getOwnPropertyDescriptor(parent, segment)?.value))

const rememberOriginal = (
  originals: Map<string, PropertyDescriptor | undefined>,
  target: GlobalTarget,
  key: string,
): void => {
  if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(target, key))
}

export const installGlobalValues = dual<
  (entries: Iterable<readonly [string, GlobalValue]>) => (target: GlobalTarget) => PriorDescriptors,
  (target: GlobalTarget, entries: Iterable<readonly [string, GlobalValue]>) => PriorDescriptors
>(2, (target, entries) => {
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of entries) {
    rememberOriginal(originals, target, key)
    defineGlobalValue(target, key, value)
  }
  return originals
})

const childFor = (parent: object, segment: string): object => {
  const existing = childGlobal(parent, segment)
  if (existing !== undefined) return existing
  const created: object = {}
  defineGlobalValue(parent, segment, created)
  return created
}

const leafContainer = (target: GlobalTarget, segments: ReadonlyArray<string>): object =>
  segments.reduce<object>((node, segment) => childFor(node, segment), target)

export const walkDefinePath = dual<
  (path: ReadonlyArray<string>, write: (parent: object, key: string) => void) => (target: GlobalTarget) => void,
  (target: GlobalTarget, path: ReadonlyArray<string>, write: (parent: object, key: string) => void) => void
>(3, (target, path, write) => {
  const pathSegments = [...path]
  const leaf = pathSegments.pop()
  if (leaf === undefined) return
  write(leafContainer(target, pathSegments), leaf)
})
