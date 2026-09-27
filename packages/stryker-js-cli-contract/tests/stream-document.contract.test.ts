import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as JsonSchema from 'effect/JsonSchema'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import * as Representation from 'effect/SchemaRepresentation'
import { Arbitrary } from 'effect/unstable/arbitrary'

const Feature = makeFeature({ it })

const PARITY_RUNS = 300

const isJsonObject = (node: S.Json): node is S.JsonObject =>
  typeof node === 'object' && node !== null && !Array.isArray(node)

const closedNode = (node: S.Json): S.Json => {
  if (isJsonObject(node)) return closedObject(node)
  if (Array.isArray(node)) return node.map(closedNode)
  return node
}

const closedObject = (node: S.JsonObject): S.JsonObject =>
  Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, key === 'additionalProperties' ? false : closedNode(value)]),
  )

type DocumentCodec = S.Codec<S.Json, S.Json>

const importedDocument = (document: JsonSchema.JsonSchema): DocumentCodec =>
  S.make<DocumentCodec>(
    Representation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft07(document), { patterns: 'apply' }).ast,
  )

const publishedStreamDocument = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* path.fromFileUrl(new URL('..', import.meta.url))
  const text = yield* fs.readFileString(path.join(root, 'contract', 'stream.schema.json'))
  const document = yield* S.decodeEffect(S.fromJsonString(S.Record(S.String, S.Json)))(text)
  return importedDocument(closedObject(document))
})

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const isPosition = S.is(Mutant.Position)

const positionFirst = (left: { readonly line: number; readonly column: number }, right: typeof left) =>
  left.line < right.line || (left.line === right.line && left.column <= right.column)

const withLocationsInOrder = (node: S.Json): S.Json => {
  if (Array.isArray(node)) return node.map(withLocationsInOrder)
  if (typeof node !== 'object' || node === null) return node
  const held: Record<string, S.Json> = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, withLocationsInOrder(value)]),
  )
  const { start, end } = held
  if (isPosition(start) && isPosition(end) && !positionFirst(start, end)) {
    held['start'] = end
    held['end'] = start
  }
  return held
}

const jsonOf = (text: string): Option.Option<S.Json> => S.decodeOption(S.fromJsonString(S.Json))(text)
const sameJsonText = (left: string, right: string): boolean =>
  Option.match(Option.all([jsonOf(left), jsonOf(right)]), {
    onNone: () => false,
    onSome: ([a, b]) => S.toEquivalence(S.Json)(a, b),
  })

const codecReadsLikeTheDocument = (document: DocumentCodec) => (instance: S.Json): boolean =>
  Option.match(S.encodeOption(S.fromJsonString(document))(instance), {
    onNone: () => false,
    onSome: (text) =>
      Option.match(
        S.decodeOption(RunEvent.RunEventWireLine)(`${text}\n`).pipe(
          Option.flatMap(S.encodeOption(RunEvent.RunEventWireLine)),
        ),
        { onNone: () => false, onSome: (line) => sameJsonText(text, line) },
      ),
  })

const documentReadsLikeTheCodec = (document: DocumentCodec) => (event: RunEvent.RunEventWireLine) =>
  Option.match(S.encodeOption(RunEvent.RunEventWireLine)(event), {
    onNone: () => false,
    onSome: (line) =>
      Option.match(
        S.decodeOption(S.fromJsonString(document))(line).pipe(
          Option.flatMap(S.encodeOption(S.fromJsonString(document))),
        ),
        { onNone: () => false, onSome: (text) => sameJsonText(line, text) },
      ),
  })

const verdictOf = <A>(result: Arbitrary.CheckResult<A, never>) =>
  Match.value(result).pipe(
    Match.tag('Falsified', (falsified) => ({ _tag: falsified._tag, shrunkInput: falsified.shrunkInput })),
    Match.orElse((other) => ({ _tag: other._tag })),
  )

Feature('The published stream document and the wire codec read the same lines')
  .withLayer(platformLayer)
  .live('every scenario imports the committed stream document from disk through the platform file system')
  .body(({ scenario }) => {
    scenario(
      'Every line the published stream document admits decodes and re-encodes to the same JSON',
      Gherkin.Do.pipe(
        Given('the published stream document, closed to its declared fields')(
          'document',
          () => publishedStreamDocument,
        ),
        When('every line the document generates, with its locations in order, goes through the wire codec')(
          'parity',
          (s) =>
            Arbitrary.checkEffect(
              Arbitrary.schema(s.document).pipe(
                Arbitrary.map(withLocationsInOrder),
              ),
              codecReadsLikeTheDocument(s.document),
              { runs: PARITY_RUNS },
            ).pipe(Effect.map(verdictOf)),
        ),
        Then('the codec reads every such line back unchanged')((s, expect) =>
          expect(s.parity).toEqual({ _tag: 'Passed' })
        ),
      ),
    )

    scenario(
      'Every event the wire codec encodes is a line the published stream document admits unchanged',
      Gherkin.Do.pipe(
        Given('the published stream document, closed to its declared fields')(
          'document',
          () => publishedStreamDocument,
        ),
        When('every event the codec can carry is encoded and read through the document')(
          'parity',
          (s) =>
            Arbitrary.checkEffect(
              Arbitrary.schema(RunEvent.RunEventWireLine),
              documentReadsLikeTheCodec(s.document),
              { runs: PARITY_RUNS },
            ).pipe(Effect.map(verdictOf)),
        ),
        Then('the document admits every such line and reproduces it')((s, expect) =>
          expect(s.parity).toEqual({ _tag: 'Passed' })
        ),
      ),
    )
  })
