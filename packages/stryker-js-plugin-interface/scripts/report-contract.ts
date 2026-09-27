import * as JsonSchema from 'effect/JsonSchema'
import * as Schema from 'effect/Schema'
import type * as SchemaRepresentation from 'effect/SchemaRepresentation'
import * as Representation from 'effect/SchemaRepresentation'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { MutantStatusSchema } from '../src/Mutant.schema.js'

export const UPSTREAM_PACKAGE = 'mutation-testing-report-schema'
export const UPSTREAM_VERSION = '3.9.0'
export const GENERATOR = 'scripts/generate-report.ts'

const BREAK_THRESHOLD = {
  description: 'The mutation score below which the run breaks. Null disables the break.',
  anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'null' }],
} as const

const upstreamDocument = fileURLToPath(import.meta.resolve(`${UPSTREAM_PACKAGE}/mutation-testing-report-schema.json`))

type JsonObject = { readonly [key: string]: JsonValue }
type JsonValue = JsonObject | ReadonlyArray<JsonValue> | string | number | boolean | null

const isJsonObject = (value: JsonValue): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const objectAt = (node: JsonValue | undefined, path: string): JsonObject => {
  let current: JsonValue | undefined = node
  for (const segment of path.split('.')) {
    current = current !== undefined && isJsonObject(current) ? current[segment] : undefined
  }
  if (current === undefined || !isJsonObject(current)) {
    throw new Error(`the upstream report schema has no object at ${path}`)
  }
  return current
}

const readUpstreamDocument = (): JsonObject => JSON.parse(readFileSync(upstreamDocument, 'utf8')) as JsonObject

const statusEnum = (document: JsonObject): ReadonlyArray<string> => {
  const status = objectAt(document, 'properties.files.additionalProperties.properties.mutants.items.properties.status')
  const declared = status['enum']
  if (!Array.isArray(declared) || !declared.every((member) => typeof member === 'string')) {
    throw new Error('the upstream report schema declares no mutant status enum')
  }
  return declared
}

const sameStatuses = (declared: ReadonlyArray<string>, ours: ReadonlyArray<string>): boolean =>
  declared.length === ours.length && declared.every((member) => ours.includes(member))

const withBreakThreshold = (document: JsonObject): JsonObject => {
  const properties = objectAt(document, 'properties')
  const thresholds = objectAt(properties, 'thresholds')
  return {
    ...document,
    properties: {
      ...properties,
      thresholds: { ...thresholds, properties: { ...objectAt(thresholds, 'properties'), break: BREAK_THRESHOLD } },
    },
  }
}

const assembleDocument = (document: JsonObject): JsonObject => {
  const definitions: Record<string, JsonValue> = {}
  const promoteMembers = (node: JsonValue): JsonValue => {
    if (Array.isArray(node)) return node.map(promoteMembers)
    if (!isJsonObject(node)) return node
    const walked: Record<string, JsonValue> = {}
    for (const [key, value] of Object.entries(node)) walked[key] = promoteMember(value)
    return walked
  }
  const promoteMember = (value: JsonValue): JsonValue => {
    const walked = promoteMembers(value)
    const title = isJsonObject(walked) ? walked['title'] : undefined
    if (!isJsonObject(walked) || typeof title !== 'string' || walked['type'] !== 'object') return walked
    const key = `${title.charAt(0).toLowerCase()}${title.slice(1)}`
    definitions[key] = walked
    return { $ref: `#/definitions/${key}` }
  }
  const declared = document['definitions']
  if (isJsonObject(declared)) {
    for (const [key, value] of Object.entries(declared)) definitions[key] = promoteMembers(value)
  }
  const { definitions: _dropped, ...root } = document
  return { ...(promoteMembers(root) as JsonObject), definitions }
}

const contractDocument = (upstream: JsonObject): JsonObject => assembleDocument(withBreakThreshold(upstream))

const liveSchema = (document: JsonObject): Schema.Top =>
  Representation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft07(document), { patterns: 'apply' })

const literalsSource = (members: ReadonlyArray<string>): string =>
  `Schema.Literals([${members.map((member) => JSON.stringify(member)).join(', ')}])`

const unionSource = (members: ReadonlyArray<string>): string =>
  members.map((member) => JSON.stringify(member)).join(' | ')

const countOccurrences = (source: string, needle: string): number => source.split(needle).length - 1

interface NamedCode {
  readonly name: string
  readonly code: SchemaRepresentation.Code
}

const dependencyOrder = (codes: ReadonlyArray<NamedCode>): ReadonlyArray<NamedCode> => {
  const byName = new Map(codes.map((entry) => [entry.name, entry]))
  const ordered: Array<NamedCode> = []
  const visiting = new Set<string>()
  const visit = (entry: NamedCode): void => {
    if (ordered.includes(entry)) return
    if (visiting.has(entry.name)) {
      throw new Error(`the generated report schemas reference each other cyclically at ${entry.name}`)
    }
    visiting.add(entry.name)
    for (const [name, dependency] of byName) {
      if (name !== entry.name && new RegExp(`\\b${name}\\b`).test(entry.code.runtime)) visit(dependency)
    }
    visiting.delete(entry.name)
    ordered.push(entry)
  }
  for (const entry of codes) visit(entry)
  return ordered
}

export const reportModuleSource = (): string => {
  const upstream = readUpstreamDocument()
  const members = [...MutantStatusSchema.literals]
  const declared = statusEnum(upstream)
  const document = contractDocument(upstream)
  if (!sameStatuses(declared, members)) {
    throw new Error(
      `upstream mutant statuses [${declared.join(', ')}] differ from MutantStatusSchema [${members.join(', ')}]`,
    )
  }
  const generated = Representation.toCodeDocument(
    Representation.toMultiDocument(Schema.toRepresentation(liveSchema(document))),
  )
  if (generated.codes.length === 0) throw new Error('the code generator emitted no root report schema')
  const root = generated.codes[0]
  const emitted: ReadonlyArray<NamedCode> = [
    ...generated.references.nonRecursives.map((reference) => ({ name: reference.$ref, code: reference.code })),
    { name: 'MutationTestResult', code: root },
  ]
  const literal = literalsSource(members)
  const union = unionSource(members)
  const literalCount = emitted.reduce((total, entry) => total + countOccurrences(entry.code.runtime, literal), 0)
  const unionCount = emitted.reduce((total, entry) => total + countOccurrences(entry.code.Type, union), 0)
  if (literalCount !== 1 || unionCount !== 1) {
    throw new Error(
      `the generated report schema carries ${literalCount} mutant status literals and ${unionCount} unions, expected one of each`,
    )
  }
  const exported: ReadonlyArray<NamedCode> = emitted.map((entry) => ({
    name: entry.name,
    code: {
      runtime: entry.code.runtime.replaceAll(literal, 'MutantStatusSchema'),
      Type: entry.code.Type.replaceAll(union, 'MutantStatus'),
    },
  }))
  return [
    `// Generated from ${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION} by ${GENERATOR}. Do not edit.`,
    `import * as Schema from 'effect/Schema'`,
    '',
    `import { type MutantStatus, MutantStatusSchema } from '../Mutant.schema.js'`,
    '',
    ...dependencyOrder(exported).flatMap(({ name, code }) => [
      `export const ${name} = ${code.runtime}`,
      `export type ${name} = ${code.Type}`,
      '',
    ]),
  ].join('\n')
}

export const reportDocumentSource = (): string => {
  const draft07 = JsonSchema.toDocumentDraft07(
    Schema.toJsonSchemaDocument(liveSchema(contractDocument(readUpstreamDocument()))),
  )
  const published = {
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_07,
    ...draft07.schema,
    definitions: draft07.definitions,
  }
  return `${JSON.stringify(published, null, 2)}\n`
}
