import type { GlobalValue } from './vm-json.js'

export type GlobalTarget = typeof globalThis

export type DescriptorMap = ReadonlyMap<string, PropertyDescriptor>

export type PriorDescriptors = ReadonlyMap<string, PropertyDescriptor | undefined>

const isObjectValue = (candidate: unknown): candidate is object => typeof candidate === 'object' && candidate !== null

export const captureDescriptors = (target: GlobalTarget): DescriptorMap =>
  new Map(Object.entries(Object.getOwnPropertyDescriptors(target)))

const sameDescriptor = (before: PropertyDescriptor | undefined, after: PropertyDescriptor): boolean =>
  before !== undefined && before.get === after.get && before.set === after.set &&
  Object.is(before.value, after.value) && before.writable === after.writable &&
  before.enumerable === after.enumerable && before.configurable === after.configurable

export const installedDescriptors = (before: DescriptorMap, after: DescriptorMap): DescriptorMap => {
  const installed = new Map<string, PropertyDescriptor>()
  for (const [key, descriptor] of after) {
    if (!sameDescriptor(before.get(key), descriptor)) installed.set(key, descriptor)
  }
  return installed
}

export const priorDescriptors = (before: DescriptorMap, installed: DescriptorMap): PriorDescriptors => {
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const key of installed.keys()) originals.set(key, before.get(key))
  return originals
}

export const installDescriptors = (target: GlobalTarget, descriptors: DescriptorMap): void => {
  for (const [key, descriptor] of descriptors) Object.defineProperty(target, key, descriptor)
}

export const restoreDescriptors = (target: GlobalTarget, originals: PriorDescriptors): void => {
  for (const [key, original] of originals) {
    if (original === undefined) Reflect.deleteProperty(target, key)
    else Object.defineProperty(target, key, original)
  }
}

export const defineGlobalValue = (target: object, key: string, value: GlobalValue): void => {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
}

export const childGlobal = (parent: object, segment: string): object | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(parent, segment)
  return descriptor !== undefined && isObjectValue(descriptor.value) ? descriptor.value : undefined
}

export const installGlobalValues = (
  target: GlobalTarget,
  entries: Iterable<readonly [string, GlobalValue]>,
): PriorDescriptors => {
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of entries) {
    if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(target, key))
    defineGlobalValue(target, key, value)
  }
  return originals
}

export const walkDefinePath = (
  target: GlobalTarget,
  path: ReadonlyArray<string>,
  write: (parent: object, key: string) => void,
): void => {
  const pathSegments = [...path]
  const leaf = pathSegments.pop()
  if (leaf === undefined) return
  let node: object = target
  for (const segment of pathSegments) {
    const child = childGlobal(node, segment)
    if (child === undefined) {
      const created: object = {}
      defineGlobalValue(node, segment, created)
      node = created
      continue
    }
    node = child
  }
  write(node, leaf)
}
