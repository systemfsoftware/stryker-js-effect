import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { Json, JsonArray, JsonObject } from 'effect/Schema'

export type ContractKind = 'json-schema' | 'catalog' | 'taxonomy'

export type Incompatibility = {
  readonly pointer: string
  readonly reason: string
}

export type DocumentPair = {
  readonly released: Json | undefined
  readonly committed: Json | undefined
}

export type Comparison =
  | { readonly verdict: 'comparable'; readonly incompatibilities: readonly Incompatibility[] }
  | { readonly verdict: 'unreadable'; readonly reason: string }

export type StreamVersionDeclaration =
  | { readonly status: 'declared'; readonly version: string; readonly pointer: string }
  | { readonly status: 'disagreeing'; readonly versions: readonly string[] }
  | { readonly status: 'absent' }

export type StatedStreamVersion = Exclude<StreamVersionDeclaration, { readonly status: 'absent' }>

export type DocumentShape =
  | { readonly shape: 'identified'; readonly kind: ContractKind }
  | { readonly shape: 'unidentified' }
  | { readonly shape: 'changed'; readonly from: ContractKind; readonly to: ContractKind }

const JsonDocument = S.fromJsonString(S.Json)

export const decodeJsonDocument = (text: string): Result.Result<Json, S.SchemaError> =>
  S.decodeResult(JsonDocument)(text)

const BRANCH_DISCRIMINANT = '_tag'
const SCHEMA_ROOT_MEMBER = '$schema'
const CATALOG_ENTRY_MEMBER = 'tier'
const TAXONOMY_ENTRY_MEMBER = 'attributes'
const MAX_DEPTH = 64

const memberOf = (node: JsonObject, key: string): Json | undefined => node[key]

const isObjectValue = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isArrayValue = (value: Json | undefined): value is JsonArray => Array.isArray(value)

const isStringValue = (value: Json | undefined): value is string => typeof value === 'string'

const textOf = (value: Json | undefined): string => {
  if (value === undefined) return 'absent'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

const quotedOf = (value: Json | undefined): string => {
  if (value === undefined) return 'absent'
  return typeof value === 'string' ? `"${value}"` : JSON.stringify(value)
}

const escapeSegment = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1')

const pointerJoin = (base: string, segment: string): string => `${base}/${escapeSegment(segment)}`

const deepEqual = (left: Json | undefined, right: Json | undefined): boolean => {
  if (left === right) return true
  if (isArrayValue(left) && isArrayValue(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
  }
  if (isObjectValue(left) && isObjectValue(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => key in right && deepEqual(left[key], right[key]))
  }
  return false
}

const resolvePointer = (root: Json, ref: string): Json | undefined => {
  if (!ref.startsWith('#/')) return undefined
  const segments = ref.slice(2).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
  let current: Json | undefined = root
  for (const segment of segments) {
    if (current === undefined) return undefined
    if (isArrayValue(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
    } else if (isObjectValue(current)) {
      current = memberOf(current, segment)
    } else {
      return undefined
    }
  }
  return current
}

const resolveRef = (node: Json | undefined, root: Json): Json | undefined => {
  if (!isObjectValue(node)) return node
  const ref = memberOf(node, '$ref')
  if (!isStringValue(ref)) return node
  const resolved = resolvePointer(root, ref)
  return resolved === undefined ? node : resolved
}

const typeSet = (value: Json | undefined): readonly string[] =>
  typeof value === 'string' ? [value] : isArrayValue(value) ? value.filter(isStringValue) : []

const allowedValues = (node: JsonObject): ReadonlySet<Json> | undefined => {
  if ('const' in node) return new Set([node['const']])
  const enumeration = memberOf(node, 'enum')
  return isArrayValue(enumeration) ? new Set(enumeration) : undefined
}

const branchList = (node: JsonObject): JsonArray | undefined => {
  const anyOf = memberOf(node, 'anyOf')
  if (isArrayValue(anyOf)) return anyOf
  const oneOf = memberOf(node, 'oneOf')
  return isArrayValue(oneOf) ? oneOf : undefined
}

const branchTag = (root: Json, branch: Json): string | undefined => {
  const resolved = resolveRef(branch, root)
  if (!isObjectValue(resolved)) return undefined
  const properties = memberOf(resolved, 'properties')
  if (!isObjectValue(properties)) return undefined
  const tag = memberOf(properties, BRANCH_DISCRIMINANT)
  if (!isObjectValue(tag)) return undefined
  const tagConst = memberOf(tag, 'const')
  if (isStringValue(tagConst)) return tagConst
  const tagEnum = memberOf(tag, 'enum')
  return isArrayValue(tagEnum) && isStringValue(tagEnum[0]) ? tagEnum[0] : undefined
}

const isConstrained = (node: JsonObject): boolean =>
  'const' in node ||
  'enum' in node ||
  'anyOf' in node ||
  'oneOf' in node ||
  'allOf' in node ||
  'properties' in node ||
  'items' in node

const stringList = (value: Json | undefined): readonly string[] =>
  isArrayValue(value) ? value.filter(isStringValue) : []

const typeKeyOf = (node: Json | undefined): string | undefined => {
  if (!isObjectValue(node)) return undefined
  const types = typeSet(memberOf(node, 'type'))
  return types.length === 0 ? undefined : [...types].sort().join('|')
}

const soleSameTypeBranchIndex = (branch: Json | undefined, candidates: JsonArray, root: Json): number => {
  const key = typeKeyOf(branch)
  if (key === undefined) return -1
  const matches = candidates.flatMap((candidate, index) =>
    typeKeyOf(resolveRef(candidate, root)) === key ? [index] : []
  )
  return matches.length === 1 ? matches[0] ?? -1 : -1
}

const compareSchema = (
  beforeRaw: Json | undefined,
  afterRaw: Json | undefined,
  pointer: string,
  beforeRoot: Json,
  afterRoot: Json,
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
  if (!isObjectValue(before) || !isObjectValue(after)) return

  const beforeTypes = typeSet(memberOf(before, 'type'))
  const afterTypes = typeSet(memberOf(after, 'type'))
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
        reason: `constraint narrowed: value(s) no longer allowed: ${dropped.map(quotedOf).join(', ')}`,
      })
    }
  }

  const beforeBranches = branchList(before)
  const afterBranches = branchList(after)
  const unionMember = isArrayValue(memberOf(before, 'anyOf')) || isArrayValue(memberOf(after, 'anyOf'))
    ? 'anyOf'
    : 'oneOf'
  if (beforeBranches !== undefined && beforeBranches.length > 1 && afterBranches === undefined) {
    out.push({ pointer, reason: 'union replaced by a single schema' })
  }
  if (beforeBranches !== undefined && afterBranches !== undefined) {
    for (const [index, branch] of beforeBranches.entries()) {
      const tag = branchTag(beforeRoot, branch)
      const resolvedBranch = resolveRef(branch, beforeRoot)
      const exactIndex = afterBranches.findIndex((candidate) => {
        const candidateTag = branchTag(afterRoot, candidate)
        if (tag !== undefined && candidateTag !== undefined) return tag === candidateTag
        return deepEqual(resolvedBranch, resolveRef(candidate, afterRoot))
      })
      const matchIndex = exactIndex >= 0 || tag !== undefined
        ? exactIndex
        : soleSameTypeBranchIndex(resolvedBranch, afterBranches, afterRoot)
      const branchPointer = pointerJoin(pointerJoin(pointer, unionMember), String(index))
      if (matchIndex < 0) {
        out.push({
          pointer: branchPointer,
          reason: tag !== undefined
            ? `event branch removed: ${BRANCH_DISCRIMINANT} ${quotedOf(tag)}`
            : `union branch removed at index ${index}`,
        })
      } else {
        compareSchema(branch, afterBranches[matchIndex], branchPointer, beforeRoot, afterRoot, out, depth + 1)
      }
    }
  }

  const beforeRequired = stringList(memberOf(before, 'required'))
  const afterRequired = stringList(memberOf(after, 'required'))
  for (const name of afterRequired) {
    if (!beforeRequired.includes(name)) {
      out.push({ pointer: pointerJoin(pointer, 'required'), reason: `property made required: ${name}` })
    }
  }

  const beforeProperties = memberOf(before, 'properties')
  const afterProperties = memberOf(after, 'properties')
  if (isObjectValue(beforeProperties) || isObjectValue(afterProperties)) {
    const beforeProps: JsonObject = isObjectValue(beforeProperties) ? beforeProperties : {}
    const afterProps: JsonObject = isObjectValue(afterProperties) ? afterProperties : {}
    for (const key of Object.keys(beforeProps)) {
      const childPointer = pointerJoin(pointerJoin(pointer, 'properties'), key)
      if (!(key in afterProps)) out.push({ pointer: childPointer, reason: `property removed: ${key}` })
      else compareSchema(beforeProps[key], afterProps[key], childPointer, beforeRoot, afterRoot, out, depth + 1)
    }
  }

  const beforeItems = memberOf(before, 'items')
  const afterItems = memberOf(after, 'items')
  if (beforeItems !== undefined && afterItems !== undefined) {
    compareSchema(beforeItems, afterItems, pointerJoin(pointer, 'items'), beforeRoot, afterRoot, out, depth + 1)
  }
}

const entryId = (entry: Json | undefined, index: number): string => {
  const id = isObjectValue(entry) ? memberOf(entry, 'id') : undefined
  return isStringValue(id) ? id : `#${index}`
}

const nameOf = (entry: Json | undefined): string | undefined => {
  const name = isObjectValue(entry) ? memberOf(entry, 'name') : undefined
  return isStringValue(name) ? name : undefined
}

const indexById = (entries: JsonArray): ReadonlyMap<string, JsonObject> => {
  const byId = new Map<string, JsonObject>()
  entries.forEach((entry, index) => {
    if (isObjectValue(entry)) byId.set(entryId(entry, index), entry)
  })
  return byId
}

const indexByName = (entries: JsonArray): ReadonlyMap<string, JsonObject> => {
  const byName = new Map<string, JsonObject>()
  entries.forEach((entry) => {
    const name = nameOf(entry)
    if (isObjectValue(entry) && name !== undefined) byName.set(name, entry)
  })
  return byName
}

const renamedIdOf = (
  entry: Json | undefined,
  byName: ReadonlyMap<string, JsonObject>,
  index: number,
): string | undefined => {
  const name = nameOf(entry)
  if (name === undefined) return undefined
  const renamed = byName.get(name)
  return renamed === undefined ? undefined : entryId(renamed, index)
}

const compareCatalog = (before: JsonArray, after: JsonArray): readonly Incompatibility[] => {
  const out: Incompatibility[] = []
  const byId = indexById(after)
  const byName = indexByName(after)
  for (const [index, entry] of before.entries()) {
    const id = entryId(entry, index)
    const match = byId.get(id)
    if (match === undefined) {
      const renamedId = renamedIdOf(entry, byName, index)
      out.push({
        pointer: `/${index}`,
        reason: renamedId !== undefined
          ? `catalog entry renamed: id "${id}" -> "${renamedId}"`
          : `catalog entry removed: id "${id}"`,
      })
      continue
    }
    if (!isObjectValue(entry)) continue
    const name = nameOf(entry)
    const matchName = nameOf(match)
    if (name !== undefined && name !== matchName) {
      out.push({
        pointer: `/${index}/name`,
        reason: `catalog entry renamed: name ${quotedOf(name)} -> ${quotedOf(matchName)}`,
      })
    }
    const tier = memberOf(entry, 'tier')
    const matchTier = memberOf(match, 'tier')
    if (tier !== matchTier) {
      out.push({
        pointer: `/${index}/tier`,
        reason: `catalog entry tier changed: ${textOf(tier)} -> ${textOf(matchTier)}`,
      })
    }
  }
  return out
}

const compareTaxonomy = (before: JsonArray, after: JsonArray): readonly Incompatibility[] => {
  const out: Incompatibility[] = []
  const byId = indexById(after)
  const byName = indexByName(after)
  for (const [index, entry] of before.entries()) {
    const id = entryId(entry, index)
    const match = byId.get(id)
    if (match === undefined) {
      const renamedId = renamedIdOf(entry, byName, index)
      out.push({
        pointer: `/${index}`,
        reason: renamedId !== undefined ? `span renamed: id "${id}" -> "${renamedId}"` : `span removed: id "${id}"`,
      })
      continue
    }
    if (!isObjectValue(entry)) continue
    const name = nameOf(entry)
    const matchName = nameOf(match)
    if (name !== undefined && name !== matchName) {
      out.push({
        pointer: `/${index}/name`,
        reason: `span renamed: name ${quotedOf(name)} -> ${quotedOf(matchName)}`,
      })
    }
    const beforeAttributes = memberOf(entry, 'attributes')
    const afterAttributes = memberOf(match, 'attributes')
    const beforeAttrs: JsonObject = isObjectValue(beforeAttributes) ? beforeAttributes : {}
    const afterAttrs: JsonObject = isObjectValue(afterAttributes) ? afterAttributes : {}
    for (const key of Object.keys(beforeAttrs)) {
      const childPointer = pointerJoin(pointerJoin(`/${index}`, 'attributes'), key)
      if (!(key in afterAttrs)) out.push({ pointer: childPointer, reason: `span attribute removed: ${key}` })
      else compareSchema(beforeAttrs[key], afterAttrs[key], childPointer, entry, match, out, 0)
    }
  }
  return out
}

export const kindOfDocument = (document: Json): ContractKind | undefined => {
  if (isObjectValue(document)) return SCHEMA_ROOT_MEMBER in document ? 'json-schema' : undefined
  if (!isArrayValue(document)) return undefined
  if (document.some((entry) => isObjectValue(entry) && CATALOG_ENTRY_MEMBER in entry)) return 'catalog'
  if (document.some((entry) => isObjectValue(entry) && TAXONOMY_ENTRY_MEMBER in entry)) return 'taxonomy'
  return undefined
}

const shapeOf = (released: Json, committed: Json): DocumentShape => {
  const releasedKind = kindOfDocument(released)
  const committedKind = kindOfDocument(committed)
  if (releasedKind === undefined) {
    return committedKind === undefined ? { shape: 'unidentified' } : { shape: 'identified', kind: committedKind }
  }
  if (committedKind === undefined) return { shape: 'identified', kind: releasedKind }
  if (releasedKind !== committedKind) return { shape: 'changed', from: releasedKind, to: committedKind }
  return { shape: 'identified', kind: releasedKind }
}

export const compareDocuments = (pair: DocumentPair): Comparison => {
  const released = pair.released
  const committed = pair.committed
  if (released === undefined || released === null) return { verdict: 'comparable', incompatibilities: [] }
  if (committed === undefined || committed === null) {
    return { verdict: 'comparable', incompatibilities: [{ pointer: '', reason: 'document removed' }] }
  }
  if (deepEqual(released, committed)) return { verdict: 'comparable', incompatibilities: [] }
  if (isArrayValue(released) !== isArrayValue(committed)) {
    return { verdict: 'unreadable', reason: 'document shape changed between object and array' }
  }
  const shape = shapeOf(released, committed)
  if (shape.shape === 'unidentified') {
    return { verdict: 'unreadable', reason: 'the document declares no member that identifies its kind' }
  }
  if (shape.shape === 'changed') {
    return { verdict: 'unreadable', reason: `the document changed kind: ${shape.from} -> ${shape.to}` }
  }
  if (shape.kind === 'catalog') {
    return {
      verdict: 'comparable',
      incompatibilities: isArrayValue(released) && isArrayValue(committed) ? compareCatalog(released, committed) : [],
    }
  }
  if (shape.kind === 'taxonomy') {
    return {
      verdict: 'comparable',
      incompatibilities: isArrayValue(released) && isArrayValue(committed) ? compareTaxonomy(released, committed) : [],
    }
  }
  const out: Incompatibility[] = []
  compareSchema(released, committed, '', released, committed, out, 0)
  return { verdict: 'comparable', incompatibilities: out }
}

export const wasIncompatible = (comparison: Comparison): boolean =>
  comparison.verdict === 'unreadable' || comparison.incompatibilities.length > 0

export const streamVersionOf = (document: Json): StreamVersionDeclaration => {
  const declarations: { readonly version: string; readonly pointer: string }[] = []
  const walk = (node: Json, pointer: string): void => {
    if (isArrayValue(node)) {
      node.forEach((entry, index) => walk(entry, pointerJoin(pointer, String(index))))
      return
    }
    if (!isObjectValue(node)) return
    const properties = memberOf(node, 'properties')
    if (isObjectValue(properties) && 'schemaVersion' in properties) {
      const version = memberOf(properties, 'schemaVersion')
      if (isObjectValue(version)) {
        const versionPointer = pointerJoin(pointerJoin(pointer, 'properties'), 'schemaVersion')
        const single = memberOf(version, 'const')
        const enumerated = memberOf(version, 'enum')
        if (isStringValue(single)) declarations.push({ version: single, pointer: versionPointer })
        else if (isArrayValue(enumerated) && isStringValue(enumerated[0])) {
          declarations.push({ version: enumerated[0], pointer: versionPointer })
        }
      }
    }
    for (const key of Object.keys(node)) walk(node[key], pointerJoin(pointer, key))
  }
  walk(document, '')
  if (declarations.length === 0) return { status: 'absent' }
  const versions = [...new Set(declarations.map((declaration) => declaration.version))]
  if (versions.length > 1) return { status: 'disagreeing', versions }
  return { status: 'declared', version: versions[0], pointer: declarations[0].pointer }
}
