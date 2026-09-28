export type ContractKind = 'json-schema' | 'catalog' | 'taxonomy'

export type Incompatibility = {
  readonly pointer: string
  readonly reason: string
}

type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const escapeSegment = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1')

const pointerJoin = (base: string, segment: string): string => `${base}/${escapeSegment(segment)}`

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => deepEqual(value, b[index]))
  }
  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    return aKeys.length === bKeys.length && aKeys.every((key) => key in b && deepEqual(a[key], b[key]))
  }
  return false
}

const resolvePointer = (root: unknown, ref: string): unknown => {
  if (!ref.startsWith('#/')) return undefined
  const segments = ref.slice(2).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
  let current: unknown = root
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
    } else if (isObject(current)) {
      current = current[segment]
    } else return undefined
  }
  return current
}

const resolveRef = (node: unknown, root: unknown): unknown => {
  if (isObject(node) && typeof node.$ref === 'string') {
    const resolved = resolvePointer(root, node.$ref)
    if (resolved !== undefined) return resolved
  }
  return node
}

const typeSet = (value: unknown): readonly string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []

const allowedValues = (node: JsonObject): ReadonlySet<unknown> | undefined => {
  if ('const' in node) return new Set([node.const])
  if (Array.isArray(node.enum)) return new Set(node.enum)
  return undefined
}

const branchList = (node: JsonObject): readonly unknown[] | undefined => {
  if (Array.isArray(node.anyOf)) return node.anyOf
  if (Array.isArray(node.oneOf)) return node.oneOf
  return undefined
}

const branchTag = (root: unknown, branch: unknown): string | undefined => {
  const resolved = resolveRef(branch, root)
  if (!isObject(resolved) || !isObject(resolved.properties)) return undefined
  const tag = resolved.properties._tag
  if (!isObject(tag)) return undefined
  if (typeof tag.const === 'string') return tag.const
  if (Array.isArray(tag.enum) && typeof tag.enum[0] === 'string') return tag.enum[0]
  return undefined
}

const isConstrained = (node: JsonObject): boolean =>
  'const' in node ||
  'enum' in node ||
  'anyOf' in node ||
  'oneOf' in node ||
  'allOf' in node ||
  'properties' in node ||
  'items' in node

const stringList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const MAX_DEPTH = 64

const compareSchema = (
  beforeRaw: unknown,
  afterRaw: unknown,
  pointer: string,
  beforeRoot: unknown,
  afterRoot: unknown,
  out: Incompatibility[],
  depth: number,
): void => {
  if (depth > MAX_DEPTH) return
  const after = resolveRef(afterRaw, afterRoot)
  if (after === undefined || after === null) {
    out.push({ pointer, reason: 'schema removed' })
    return
  }
  const before = resolveRef(beforeRaw, beforeRoot)
  if (before === undefined || before === null) return
  if (before === true && after === false) {
    out.push({ pointer, reason: 'schema narrowed to false: nothing is allowed' })
    return
  }
  if (!isObject(before) || !isObject(after)) return

  const beforeTypes = typeSet(before.type)
  const afterTypes = typeSet(after.type)
  if (beforeTypes.length > 0 && afterTypes.length > 0) {
    const dropped = beforeTypes.filter((entry) => !afterTypes.includes(entry))
    if (dropped.length > 0) {
      out.push({
        pointer: pointerJoin(pointer, 'type'),
        reason: `type narrowed: ${dropped.join(' | ')} no longer allowed`,
      })
    }
  } else if (beforeTypes.length === 0 && afterTypes.length > 0 && !isConstrained(before)) {
    out.push({
      pointer: pointerJoin(pointer, 'type'),
      reason: `type narrowed to ${afterTypes.join(' | ')} from unconstrained`,
    })
  }

  const beforeAllowed = allowedValues(before)
  const afterAllowed = allowedValues(after)
  if (beforeAllowed !== undefined && afterAllowed !== undefined) {
    const dropped = [...beforeAllowed].filter((value) => !afterAllowed.has(value))
    if (dropped.length > 0) {
      out.push({
        pointer,
        reason: `constraint narrowed: value(s) no longer allowed: ${
          dropped.map((value) => JSON.stringify(value)).join(', ')
        }`,
      })
    }
  }

  const beforeBranches = branchList(before)
  const afterBranches = branchList(after)
  const branchKey = Array.isArray(before.anyOf) || Array.isArray(after.anyOf) ? 'anyOf' : 'oneOf'
  if (beforeBranches !== undefined && beforeBranches.length > 1 && afterBranches === undefined) {
    out.push({ pointer, reason: 'union replaced by a single schema' })
  }
  if (beforeBranches !== undefined && afterBranches !== undefined) {
    beforeBranches.forEach((branch, index) => {
      const tag = branchTag(beforeRoot, branch)
      const matchIndex = afterBranches.findIndex((candidate) => {
        const candidateTag = branchTag(afterRoot, candidate)
        if (tag !== undefined && candidateTag !== undefined) return tag === candidateTag
        return deepEqual(resolveRef(branch, beforeRoot), resolveRef(candidate, afterRoot))
      })
      const branchPointer = pointerJoin(pointerJoin(pointer, branchKey), String(index))
      if (matchIndex < 0) {
        out.push({
          pointer: branchPointer,
          reason: tag !== undefined
            ? `event branch removed: _tag "${tag}"`
            : `union branch removed at index ${index}`,
        })
      } else {
        compareSchema(branch, afterBranches[matchIndex], branchPointer, beforeRoot, afterRoot, out, depth + 1)
      }
    })
  }

  const beforeRequired = stringList(before.required)
  const afterRequired = stringList(after.required)
  for (const name of afterRequired) {
    if (!beforeRequired.includes(name)) {
      out.push({ pointer: pointerJoin(pointer, 'required'), reason: `property made required: ${name}` })
    }
  }

  if (isObject(before.properties) || isObject(after.properties)) {
    const beforeProps = isObject(before.properties) ? before.properties : {}
    const afterProps = isObject(after.properties) ? after.properties : {}
    for (const key of Object.keys(beforeProps)) {
      const childPointer = pointerJoin(pointerJoin(pointer, 'properties'), key)
      if (!(key in afterProps)) out.push({ pointer: childPointer, reason: `property removed: ${key}` })
      else compareSchema(beforeProps[key], afterProps[key], childPointer, beforeRoot, afterRoot, out, depth + 1)
    }
  }

  if (before.items !== undefined && after.items !== undefined) {
    compareSchema(before.items, after.items, pointerJoin(pointer, 'items'), beforeRoot, afterRoot, out, depth + 1)
  }
}

const entryId = (entry: unknown, index: number): string =>
  isObject(entry) && typeof entry.id === 'string' ? entry.id : `#${index}`

const indexByIdAndName = (
  entries: readonly unknown[],
): { readonly byId: Map<string, JsonObject>; readonly byName: Map<string, JsonObject> } => {
  const byId = new Map<string, JsonObject>()
  const byName = new Map<string, JsonObject>()
  entries.forEach((entry, index) => {
    if (!isObject(entry)) return
    byId.set(entryId(entry, index), entry)
    if (typeof entry.name === 'string') byName.set(entry.name, entry)
  })
  return { byId, byName }
}

const compareCatalog = (before: readonly unknown[], after: readonly unknown[]): readonly Incompatibility[] => {
  const out: Incompatibility[] = []
  const { byId, byName } = indexByIdAndName(after)
  before.forEach((entry, index) => {
    const id = entryId(entry, index)
    const match = byId.get(id)
    if (match === undefined) {
      const renamed = isObject(entry) && typeof entry.name === 'string' ? byName.get(entry.name) : undefined
      out.push({
        pointer: `/${index}`,
        reason: renamed !== undefined
          ? `catalog entry renamed: id "${id}" -> "${String(renamed.id)}"`
          : `catalog entry removed: id "${id}"`,
      })
      return
    }
    if (!isObject(entry)) return
    if (typeof entry.name === 'string' && entry.name !== match.name) {
      out.push({
        pointer: `/${index}/name`,
        reason: `catalog entry renamed: name "${entry.name}" -> "${String(match.name)}"`,
      })
    }
    if (entry.tier !== match.tier) {
      out.push({
        pointer: `/${index}/tier`,
        reason: `catalog entry tier changed: ${String(entry.tier)} -> ${String(match.tier)}`,
      })
    }
  })
  return out
}

const compareTaxonomy = (before: readonly unknown[], after: readonly unknown[]): readonly Incompatibility[] => {
  const out: Incompatibility[] = []
  const { byId, byName } = indexByIdAndName(after)
  before.forEach((entry, index) => {
    const id = entryId(entry, index)
    const match = byId.get(id)
    if (match === undefined) {
      const renamed = isObject(entry) && typeof entry.name === 'string' ? byName.get(entry.name) : undefined
      out.push({
        pointer: `/${index}`,
        reason: renamed !== undefined
          ? `span renamed: id "${id}" -> "${String(renamed.id)}"`
          : `span removed: id "${id}"`,
      })
      return
    }
    if (!isObject(entry)) return
    if (typeof entry.name === 'string' && entry.name !== match.name) {
      out.push({ pointer: `/${index}/name`, reason: `span renamed: name "${entry.name}" -> "${String(match.name)}"` })
    }
    const beforeAttrs = isObject(entry.attributes) ? entry.attributes : {}
    const afterAttrs = isObject(match.attributes) ? match.attributes : {}
    for (const key of Object.keys(beforeAttrs)) {
      const childPointer = pointerJoin(pointerJoin(`/${index}`, 'attributes'), key)
      if (!(key in afterAttrs)) out.push({ pointer: childPointer, reason: `span attribute removed: ${key}` })
      else compareSchema(beforeAttrs[key], afterAttrs[key], childPointer, entry, match, out, 0)
    }
  })
  return out
}

export const classifyDocument = (
  kind: ContractKind,
  before: unknown,
  after: unknown,
): readonly Incompatibility[] => {
  if (before === undefined || before === null) return []
  if (after === undefined || after === null) return [{ pointer: '', reason: 'document removed' }]
  if (deepEqual(before, after)) return []
  if (Array.isArray(before) !== Array.isArray(after)) {
    return [{ pointer: '', reason: 'document shape changed between object and array' }]
  }
  switch (kind) {
    case 'catalog':
      return Array.isArray(before) && Array.isArray(after) ? compareCatalog(before, after) : []
    case 'taxonomy':
      return Array.isArray(before) && Array.isArray(after) ? compareTaxonomy(before, after) : []
    case 'json-schema': {
      const out: Incompatibility[] = []
      compareSchema(before, after, '', before, after, out, 0)
      return out
    }
  }
}

export const streamVersionOf = (document: unknown): string | undefined => {
  const found = new Set<string>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!isObject(node)) return
    const properties = node.properties
    if (isObject(properties) && 'schemaVersion' in properties) {
      const version = properties.schemaVersion
      if (isObject(version)) {
        if (typeof version.const === 'string') found.add(version.const)
        else if (Array.isArray(version.enum) && typeof version.enum[0] === 'string') found.add(version.enum[0])
      }
    }
    Object.values(node).forEach(walk)
  }
  walk(document)
  if (found.size > 1) {
    throw new Error(`stream contract declares disagreeing schemaVersion consts: ${[...found].join(', ')}`)
  }
  return found.size === 1 ? [...found][0] : undefined
}

export const majorOf = (version: string): number => {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10)
  return Number.isNaN(major) ? -1 : major
}
