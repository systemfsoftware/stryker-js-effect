import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import type { Json } from 'effect/Schema'

import {
  type ChangeIntent,
  type ChangesetFile,
  decodePackageVersion,
  decodeShippedManifest,
  decodeWorkspaceGlobs,
  pendingIntentsOf,
} from './__fixtures__/changeset-intents.fixture.js'
import { decodeJsonDocument } from './__fixtures__/contract-compat.fixture.js'
import {
  type ContractDocument,
  type ContractLawInput,
  evaluateContractLaw,
  type PackageContracts,
  renderFailure,
} from './__fixtures__/contract-law.fixture.js'

const Feature = makeFeature({ it })

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const CLI_CONTRACT = '@systemfsoftware/stryker-js-cli-contract'
const CLI_CONTRACT_DIRECTORY = 'packages/stryker-js-cli-contract'
const CLI_CONTRACT_RELEASE = 'released-stryker-js-cli-contract'
const PLUGIN_INTERFACE = '@systemfsoftware/stryker-js-plugin-interface'
const PLUGIN_INTERFACE_DIRECTORY = 'packages/stryker-js-plugin-interface'
const PLUGIN_INTERFACE_RELEASE = 'released-stryker-js-plugin-interface'

const CONTRACT_DIRECTORY = 'contract'
const CHANGESET_DIRECTORY = '.changeset'
const CHANGESET_LEDGER = 'ledger.yaml'
const CHANGESET_README = 'README.md'
const JSON_EXTENSION = '.json'
const MARKDOWN_EXTENSION = '.md'
const MANIFEST_FILE = 'package.json'
const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml'
const DIRECTORY_GLOB = '/*'
const NODE_MODULES = 'node_modules'
const STREAM_DOCUMENT = 'stream.schema.json'
const REPORT_DOCUMENT = 'report.schema.json'
const STOCK_CATALOG_DOCUMENT = 'stock-catalog.json'
const SPAN_TAXONOMY_DOCUMENT = 'span-taxonomy.json'

type PackageRef = {
  readonly name: string
  readonly directory: string
  readonly releasedAlias: string
}

const PACKAGES: readonly PackageRef[] = [
  { name: CLI_CONTRACT, directory: CLI_CONTRACT_DIRECTORY, releasedAlias: CLI_CONTRACT_RELEASE },
  { name: PLUGIN_INTERFACE, directory: PLUGIN_INTERFACE_DIRECTORY, releasedAlias: PLUGIN_INTERFACE_RELEASE },
]

const readJsonDocuments = (directory: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const names = (yield* fs.readDirectory(directory)).filter((name) => name.endsWith(JSON_EXTENSION)).sort()
    const documents: ContractDocument[] = []
    for (const name of names) {
      const file = path.join(directory, name)
      const decoded = decodeJsonDocument(yield* fs.readFileString(file))
      if (Result.isFailure(decoded)) {
        return yield* Effect.die(
          new Error(`cannot decode the contract document at ${file}: ${decoded.failure.message}`),
        )
      }
      documents.push({ name, document: decoded.success })
    }
    return documents
  })

const readVersion = (manifestPath: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const decoded = decodePackageVersion(yield* fs.readFileString(manifestPath))
    if (Result.isFailure(decoded)) {
      return yield* Effect.die(new Error(`cannot read a version from ${manifestPath}: ${decoded.failure.message}`))
    }
    return decoded.success
  })

const readPendingIntents = (changesetDirectory: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const names = (yield* fs.readDirectory(changesetDirectory))
      .filter((name) => name.endsWith(MARKDOWN_EXTENSION) && name !== CHANGESET_README)
      .sort()
    const files: ChangesetFile[] = []
    for (const name of names) {
      files.push({ name, markdown: yield* fs.readFileString(path.join(changesetDirectory, name)) })
    }
    const intents = pendingIntentsOf({
      files,
      ledgerYamlText: yield* fs.readFileString(path.join(changesetDirectory, CHANGESET_LEDGER)),
    })
    if (Result.isFailure(intents)) {
      return yield* Effect.die(new Error(`cannot read the pending changesets: ${intents.failure}`))
    }
    return intents.success
  })

const readWorkspace = () =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const repositoryRoot = yield* path.fromFileUrl(new URL('../../../', import.meta.url))
    const releasedRoot = path.join(repositoryRoot, CLI_CONTRACT_DIRECTORY, NODE_MODULES)
    const packages: PackageContracts[] = []
    for (const ref of PACKAGES) {
      const packageDirectory = path.join(repositoryRoot, ref.directory)
      const releasedDirectory = path.join(releasedRoot, ref.releasedAlias)
      packages.push({
        name: ref.name,
        directory: ref.directory,
        releasedVersion: yield* readVersion(path.join(releasedDirectory, MANIFEST_FILE)),
        committedVersion: yield* readVersion(path.join(packageDirectory, MANIFEST_FILE)),
        releasedDocuments: yield* readJsonDocuments(path.join(releasedDirectory, CONTRACT_DIRECTORY)),
        committedDocuments: yield* readJsonDocuments(path.join(packageDirectory, CONTRACT_DIRECTORY)),
      })
    }
    return { packages, pendingIntents: yield* readPendingIntents(path.join(repositoryRoot, CHANGESET_DIRECTORY)) }
  })

const readContractShippingPackages = () =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const repositoryRoot = yield* path.fromFileUrl(new URL('../../../', import.meta.url))
    const globs = decodeWorkspaceGlobs(yield* fs.readFileString(path.join(repositoryRoot, WORKSPACE_MANIFEST)))
    if (Result.isFailure(globs)) {
      return yield* Effect.die(new Error(`cannot read the workspace package globs: ${globs.failure.message}`))
    }
    const shipping: string[] = []
    for (const glob of globs.success) {
      if (!glob.endsWith(DIRECTORY_GLOB)) {
        return yield* Effect.die(new Error(`the workspace glob ${glob} is not a <directory>/* glob the law can expand`))
      }
      const parent = path.join(repositoryRoot, glob.slice(0, -DIRECTORY_GLOB.length))
      for (const entry of yield* fs.readDirectory(parent)) {
        const packageDirectory = path.join(parent, entry)
        const manifestPath = path.join(packageDirectory, MANIFEST_FILE)
        const isDirectory = (yield* fs.stat(packageDirectory)).type === 'Directory'
        if (isDirectory && (yield* fs.exists(manifestPath))) {
          const manifest = decodeShippedManifest(yield* fs.readFileString(manifestPath))
          if (Result.isFailure(manifest)) {
            return yield* Effect.die(new Error(`cannot read ${manifestPath}: ${manifest.failure.message}`))
          }
          if (manifest.success.files.includes(CONTRACT_DIRECTORY)) shipping.push(manifest.success.name)
        }
      }
    }
    return shipping.sort()
  })

const streamDocument = (options: { readonly schemaVersion: string; readonly pid: boolean }): Json => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  definitions: {
    runStart: {
      type: 'object',
      properties: {
        _tag: { const: 'runStart' },
        schemaVersion: { type: 'string', const: options.schemaVersion },
        ...options.pid ? { pid: { type: 'integer' } } : {},
      },
      required: ['_tag', 'schemaVersion'],
    },
  },
  anyOf: [{ $ref: '#/definitions/runStart' }],
})

type LawScenario = {
  readonly package: string
  readonly directory: string
  readonly releasedVersion: string
  readonly committedVersion: string
  readonly releasedDocuments: readonly ContractDocument[]
  readonly committedDocuments: readonly ContractDocument[]
  readonly pendingIntents: readonly ChangeIntent[]
}

const lawInputOf = (request: LawScenario): ContractLawInput => ({
  packages: [{
    name: request.package,
    directory: request.directory,
    releasedVersion: request.releasedVersion,
    committedVersion: request.committedVersion,
    releasedDocuments: request.releasedDocuments,
    committedDocuments: request.committedDocuments,
  }],
  pendingIntents: request.pendingIntents,
})

const reportDocument: ContractDocument = {
  name: REPORT_DOCUMENT,
  document: { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'report' },
}

const releasedDocumentOf = (name: string): ContractDocument => ({
  name,
  document: { $schema: 'https://json-schema.org/draft/2020-12/schema', title: `released ${name}` },
})

const streamDocumentPair = (committedVersion: string, pid: boolean): readonly ContractDocument[] => [
  { name: STREAM_DOCUMENT, document: streamDocument({ schemaVersion: committedVersion, pid }) },
]

const schemaDocument = (options: { readonly testFiles: boolean; readonly wideLevel: boolean }): Json => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    schemaVersion: { type: 'string' },
    level: { type: options.wideLevel ? ['string', 'number'] : 'string' },
    ...options.testFiles ? { testFiles: { type: 'object' } } : {},
  },
  required: ['schemaVersion'],
})

const nullableStructDocument = (properties: Json, required: readonly string[]): Json => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    durations: { anyOf: [{ type: 'object', properties, required: [...required] }, { type: 'null' }] },
  },
})

const catalogEntry: Json = {
  id: 'arithmetic-operator',
  name: 'ArithmeticOperator',
  tier: 'default',
  definition: 'a binary arithmetic operator',
  examples: [],
}

const spanTaxonomy = (attributes: readonly string[]): Json => [{
  id: 'stryker.checker.check',
  name: 'stryker.checker.check',
  attributes: Object.fromEntries(attributes.map((key) => [key, { type: 'string' }])),
}]

const unchangedStream: LawScenario = {
  package: CLI_CONTRACT,
  directory: CLI_CONTRACT_DIRECTORY,
  releasedVersion: '0.4.0',
  committedVersion: '0.4.0',
  releasedDocuments: [{ name: STREAM_DOCUMENT, document: streamDocument({ schemaVersion: '6.0', pid: true }) }],
  committedDocuments: streamDocumentPair('6.0', false),
  pendingIntents: [{ package: CLI_CONTRACT, bump: 'major' }],
}

const raisedStream: LawScenario = { ...unchangedStream, committedDocuments: streamDocumentPair('7.0', false) }

const unclassifiableDocument: LawScenario = {
  package: PLUGIN_INTERFACE,
  directory: PLUGIN_INTERFACE_DIRECTORY,
  releasedVersion: '15.0.0',
  committedVersion: '15.0.0',
  releasedDocuments: [{ name: REPORT_DOCUMENT, document: { released: true } }],
  committedDocuments: [{ name: REPORT_DOCUMENT, document: { committed: true } }],
  pendingIntents: [{ package: PLUGIN_INTERFACE, bump: 'major' }],
}

const staleBaseline: LawScenario = {
  package: PLUGIN_INTERFACE,
  directory: PLUGIN_INTERFACE_DIRECTORY,
  releasedVersion: '15.0.0',
  committedVersion: '15.1.0',
  releasedDocuments: [reportDocument],
  committedDocuments: [reportDocument],
  pendingIntents: [{ package: PLUGIN_INTERFACE, bump: 'patch' }],
}

const laggingPinNarrowing: LawScenario = {
  package: PLUGIN_INTERFACE,
  directory: PLUGIN_INTERFACE_DIRECTORY,
  releasedVersion: '15.0.0',
  committedVersion: '16.0.0',
  releasedDocuments: [{ name: REPORT_DOCUMENT, document: schemaDocument({ testFiles: true, wideLevel: true }) }],
  committedDocuments: [{ name: REPORT_DOCUMENT, document: schemaDocument({ testFiles: false, wideLevel: true }) }],
  pendingIntents: [],
}

Feature('The released contract documents bound what the workspace may declare next')
  .withLayer(platformLayer)
  .body(({ scenario, scenarioOutline }) => {
    scenario(
      'The committed contract documents keep every ground the released ones hold',
      { live: 'reads the released tarballs, the committed documents and the changeset ledger from disk' },
      Gherkin.Do.pipe(
        Given('the released documents the workspace consumes and the committed ones it ships')(
          'workspace',
          () => readWorkspace(),
        ),
        Given('every workspace package whose manifest ships a contract directory')(
          'shipping',
          () => readContractShippingPackages(),
        ),
        When('the version law weighs each committed document against the released one')(
          'failures',
          (s) => Effect.succeed(evaluateContractLaw(s.workspace).map(renderFailure)),
        ),
        Then(
          'every package that ships a contract directory is weighed, and none is narrower than its release without a declared next version that clears it',
        )((s, expect) =>
          expect({ weighed: s.workspace.packages.map((pkg) => pkg.name).sort(), failures: s.failures }).toEqual({
            weighed: s.shipping,
            failures: [],
          })
        ),
      ),
    )

    scenarioOutline(
      'A document the workspace removed is refused until the declared version clears the release',
      [
        {
          package: PLUGIN_INTERFACE,
          directory: PLUGIN_INTERFACE_DIRECTORY,
          document: REPORT_DOCUMENT,
          releasedVersion: '15.0.0',
          requiredLevel: 'major',
          requiredVersion: '16.0.0',
          declaredVersion: '15.0.1',
        },
        {
          package: CLI_CONTRACT,
          directory: CLI_CONTRACT_DIRECTORY,
          document: STREAM_DOCUMENT,
          releasedVersion: '0.4.0',
          requiredLevel: 'minor',
          requiredVersion: '0.5.0',
          declaredVersion: '0.4.1',
        },
      ],
      (row) =>
        Gherkin.Do.pipe(
          Given('a released document of a package that now ships no documents, with a patch intent')(
            'law',
            () =>
              Effect.succeed(
                lawInputOf({
                  package: row.package,
                  directory: row.directory,
                  releasedVersion: row.releasedVersion,
                  committedVersion: row.releasedVersion,
                  releasedDocuments: [releasedDocumentOf(row.document)],
                  committedDocuments: [],
                  pendingIntents: [{ package: row.package, bump: 'patch' }],
                }),
              ),
          ),
          When('the law weighs the committed documents against the released ones')(
            'failures',
            (s) => Effect.succeed(evaluateContractLaw(s.law)),
          ),
          Then('the removal is named with the required level and the declared patch version')(
            (s, expect) =>
              expect(s.failures).toEqual([{
                kind: 'contract-change',
                package: row.package,
                document: `${row.directory}/${CONTRACT_DIRECTORY}/${row.document}`,
                pointer: '',
                reason: 'document removed',
                requiredLevel: row.requiredLevel,
                requiredVersion: row.requiredVersion,
                declaredVersion: row.declaredVersion,
              }]),
          ),
        ),
    )

    scenarioOutline(
      'A committed document that drops what the release declared is refused at the member it dropped',
      [
        {
          document: STREAM_DOCUMENT,
          released: schemaDocument({ testFiles: true, wideLevel: true }),
          committed: schemaDocument({ testFiles: false, wideLevel: true }),
          pointer: '/properties/testFiles',
          reason: 'property removed: testFiles',
        },
        {
          document: STREAM_DOCUMENT,
          released: schemaDocument({ testFiles: true, wideLevel: true }),
          committed: schemaDocument({ testFiles: true, wideLevel: false }),
          pointer: '/properties/level/type',
          reason: 'type narrowed: number no longer allowed',
        },
        {
          document: STOCK_CATALOG_DOCUMENT,
          released: [catalogEntry],
          committed: [],
          pointer: '/0',
          reason: 'catalog entry removed: id "arithmetic-operator"',
        },
        {
          document: SPAN_TAXONOMY_DOCUMENT,
          released: spanTaxonomy(['stryker.mutants.count', 'stryker.checker.name']),
          committed: spanTaxonomy(['stryker.mutants.count']),
          pointer: '/0/attributes/stryker.checker.name',
          reason: 'span attribute removed: stryker.checker.name',
        },
      ],
      (row) =>
        Gherkin.Do.pipe(
          Given('a released document that declares one more member than the committed one, with a patch intent')(
            'law',
            () =>
              Effect.succeed(
                lawInputOf({
                  package: CLI_CONTRACT,
                  directory: CLI_CONTRACT_DIRECTORY,
                  releasedVersion: '0.4.0',
                  committedVersion: '0.4.0',
                  releasedDocuments: [{ name: row.document, document: row.released }],
                  committedDocuments: [{ name: row.document, document: row.committed }],
                  pendingIntents: [{ package: CLI_CONTRACT, bump: 'patch' }],
                }),
              ),
          ),
          When('the law weighs the committed document against the released one')(
            'failures',
            (s) => Effect.succeed(evaluateContractLaw(s.law)),
          ),
          Then('the dropped member is named at its pointer with the requirement the declared patch misses')(
            (s, expect) =>
              expect(s.failures).toEqual([{
                kind: 'contract-change',
                package: CLI_CONTRACT,
                document: `${CLI_CONTRACT_DIRECTORY}/${CONTRACT_DIRECTORY}/${row.document}`,
                pointer: row.pointer,
                reason: row.reason,
                requiredLevel: 'minor',
                requiredVersion: '0.5.0',
                declaredVersion: '0.4.1',
              }]),
          ),
        ),
    )

    scenarioOutline(
      'A member added inside a nullable struct is weighed inside the struct, not as a removed branch',
      [
        { addition: 'optional', required: ['a'], failures: [] },
        {
          addition: 'required',
          required: ['a', 'b'],
          failures: [{ pointer: '/properties/durations/anyOf/0/required', reason: 'property made required: b' }],
        },
      ],
      (row) =>
        Gherkin.Do.pipe(
          Given('a released nullable struct and a committed one that adds a member, with a patch intent')(
            'law',
            () =>
              Effect.succeed(
                lawInputOf({
                  package: CLI_CONTRACT,
                  directory: CLI_CONTRACT_DIRECTORY,
                  releasedVersion: '0.4.0',
                  committedVersion: '0.4.0',
                  releasedDocuments: [{
                    name: STREAM_DOCUMENT,
                    document: nullableStructDocument({ a: { type: 'number' } }, ['a']),
                  }],
                  committedDocuments: [{
                    name: STREAM_DOCUMENT,
                    document: nullableStructDocument({ a: { type: 'number' }, b: { type: 'number' } }, row.required),
                  }],
                  pendingIntents: [{ package: CLI_CONTRACT, bump: 'patch' }],
                }),
              ),
          ),
          When('the law weighs the committed document against the released one')(
            'failures',
            (s) => Effect.succeed(evaluateContractLaw(s.law)),
          ),
          Then('only a newly required member is refused, at the member inside the struct')((s, expect) =>
            expect(s.failures).toEqual(row.failures.map((failure) => ({
              kind: 'contract-change',
              package: CLI_CONTRACT,
              document: `${CLI_CONTRACT_DIRECTORY}/${CONTRACT_DIRECTORY}/${STREAM_DOCUMENT}`,
              pointer: failure.pointer,
              reason: failure.reason,
              requiredLevel: 'minor',
              requiredVersion: '0.5.0',
              declaredVersion: '0.4.1',
            })))
          ),
        ),
    )

    scenario(
      'A breaking stream change demands a higher stream version major than the release declares',
      Gherkin.Do.pipe(
        Given('a released stream document declaring 6.0 and two committed ones, one at 6.0 and one at 7.0')(
          'cases',
          () => Effect.succeed({ unchanged: lawInputOf(unchangedStream), raised: lawInputOf(raisedStream) }),
        ),
        When('the law weighs both committed documents against the released one')(
          'verdicts',
          (s) =>
            Effect.succeed({
              unchanged: evaluateContractLaw(s.cases.unchanged),
              raised: evaluateContractLaw(s.cases.raised),
            }),
        ),
        Then('the unchanged stream version is refused at its declaration while the raised one passes')(
          (s, expect) =>
            expect(s.verdicts).toEqual({
              unchanged: [{
                kind: 'stream-version',
                package: CLI_CONTRACT,
                document: `${CLI_CONTRACT_DIRECTORY}/${CONTRACT_DIRECTORY}/${STREAM_DOCUMENT}`,
                pointer: '/definitions/runStart/properties/schemaVersion',
                reason: expect.stringContaining('a higher stream version major'),
                releasedStreamVersion: '6.0',
                declaredStreamVersion: '6.0',
              }],
              raised: [],
            }),
        ),
      ),
    )

    scenario(
      'A document that declares no member identifying its kind is named rather than defaulted',
      Gherkin.Do.pipe(
        Given('a declared major version that would clear a break, and two documents that name no kind')(
          'law',
          () => Effect.succeed(lawInputOf(unclassifiableDocument)),
        ),
        When('the law weighs the committed document against the released one')(
          'failures',
          (s) => Effect.succeed(evaluateContractLaw(s.law)),
        ),
        Then('the unidentifiable document is still reported instead of being compared under a default kind')(
          (s, expect) =>
            expect(s.failures).toEqual([{
              kind: 'contract-change',
              package: PLUGIN_INTERFACE,
              document: `${PLUGIN_INTERFACE_DIRECTORY}/${CONTRACT_DIRECTORY}/${REPORT_DOCUMENT}`,
              pointer: '',
              reason: 'the document declares no member that identifies its kind',
              requiredLevel: 'major',
              requiredVersion: '16.0.0',
              declaredVersion: '16.0.0',
            }]),
        ),
      ),
    )

    scenario(
      'A released baseline behind the workspace version refuses to compare while a changeset is pending',
      Gherkin.Do.pipe(
        Given('a workspace one patch ahead of the released documents, with a pending patch intent')(
          'law',
          () => Effect.succeed(lawInputOf(staleBaseline)),
        ),
        When('the law weighs the committed documents against the stale released ones')(
          'failures',
          (s) => Effect.succeed(evaluateContractLaw(s.law)),
        ),
        Then('the stale baseline is named and the author is told to move the flake input')(
          (s, expect) =>
            expect(s.failures).toEqual([{
              kind: 'stale-baseline',
              package: PLUGIN_INTERFACE,
              reason: expect.stringContaining('move the stryker-published flake input to the latest release tag'),
              releasedVersion: '15.0.0',
              committedVersion: '15.1.0',
            }]),
        ),
      ),
    )

    scenario(
      'A released baseline behind the workspace version refuses a narrowing no changeset declares',
      Gherkin.Do.pipe(
        Given('a workspace a major ahead of the released documents, a dropped member, and no pending intent')(
          'law',
          () => Effect.succeed(lawInputOf(laggingPinNarrowing)),
        ),
        When('the law weighs the committed documents against the stale released ones')(
          'failures',
          (s) => Effect.succeed(evaluateContractLaw(s.law)),
        ),
        Then('the stale baseline is named instead of the workspace version clearing the narrowing')(
          (s, expect) =>
            expect(s.failures).toEqual([{
              kind: 'stale-baseline',
              package: PLUGIN_INTERFACE,
              reason: expect.stringContaining('move the stryker-published flake input to the latest release tag'),
              releasedVersion: '15.0.0',
              committedVersion: '16.0.0',
            }]),
        ),
      ),
    )

    scenario(
      'A changeset the ledger already lists is not a pending intent',
      Gherkin.Do.pipe(
        Given('a ledger listing one changeset and a changeset directory holding it beside a fresh one')(
          'inventory',
          () =>
            Effect.succeed({
              files: [
                { name: 'listed-intent.md', markdown: '---\n"@systemfsoftware/stryker-js": major\n---\n' },
                { name: 'fresh-intent.md', markdown: '---\n"@systemfsoftware/stryker-js": patch\n---\n' },
                { name: CHANGESET_README, markdown: '# Changesets\n' },
              ],
              ledgerYamlText:
                '"@systemfsoftware/stryker-js@1.0.0":\n  dir: packages/stryker-js\n  intents:\n    - listed-intent\n',
            }),
        ),
        When('the intent reader collects what the ledger leaves pending')(
          'intents',
          (s) => Effect.succeed(pendingIntentsOf(s.inventory).pipe(Result.getOrElse(() => []))),
        ),
        Then('only the changeset the ledger does not list counts as pending')(
          (s, expect) => expect(s.intents).toEqual([{ package: '@systemfsoftware/stryker-js', bump: 'patch' }]),
        ),
      ),
    )
  })
