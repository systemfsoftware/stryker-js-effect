import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect, Schema } from 'effect'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, verdictEvent } from './__fixtures__/machine-stream.fixture.js'

const CONSUMER_FIXTURE_URL = new URL('../testResources/vm-vitest-fixture', import.meta.url)
const CONSUMER_EFFECT = '4.0.0'
const INSTALLED_TREE_FILE = 'node_modules/.package-lock.json'
const NODE_MODULES = 'node_modules/'

const RUN_PATH_PACKAGES: ReadonlyArray<string> = [
  '@systemfsoftware/stryker-js',
  '@systemfsoftware/stryker-js-vitest-runner',
  '@systemfsoftware/stryker-js-typescript-checker',
]

const Edges = Schema.Record(Schema.String, Schema.String)

const InstalledTree = Schema.fromJsonString(Schema.Struct({
  packages: Schema.Record(
    Schema.String,
    Schema.Struct({
      version: Schema.optional(Schema.String),
      dependencies: Schema.optional(Edges),
      optionalDependencies: Schema.optional(Edges),
      peerDependencies: Schema.optional(Edges),
    }),
  ),
}))

interface InstalledPackage {
  readonly name: string
  readonly version: string | undefined
  readonly edges: ReadonlyArray<string>
}

const installedPackagesOf = (tree: typeof InstalledTree.Type): ReadonlyArray<InstalledPackage> =>
  Object.entries(tree.packages)
    .filter(([path]) => path !== '')
    .map(([path, installed]) => ({
      name: path.slice(path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length),
      version: installed.version,
      edges: [
        ...Object.keys(installed.dependencies ?? {}),
        ...Object.keys(installed.optionalDependencies ?? {}),
        ...Object.keys(installed.peerDependencies ?? {}),
      ],
    }))

const reachableNamesOf = (installed: ReadonlyArray<InstalledPackage>): ReadonlySet<string> => {
  const reached = new Set<string>()
  const pending = [...RUN_PATH_PACKAGES]
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (!reached.has(name)) {
      reached.add(name)
      pending.push(...installed.filter((candidate) => candidate.name === name).flatMap((candidate) => candidate.edges))
    }
  }
  return reached
}

const effectRelationsOf = (installed: ReadonlyArray<InstalledPackage>): ReadonlyArray<string> =>
  [...reachableNamesOf(installed)]
    .filter((name) =>
      name === 'effect' || installed.some((candidate) => candidate.name === name && candidate.edges.includes('effect'))
    )
    .sort()

const installedEffectVersionsOf = (
  installed: ReadonlyArray<InstalledPackage>,
): ReadonlyArray<string | undefined> => [
  ...new Set(installed.filter((candidate) => candidate.name === 'effect').map((candidate) => candidate.version)),
]

const verifyRunPathHoldsNoEffect = (expect: Expect, installed: ReadonlyArray<InstalledPackage>): Check =>
  expect(effectRelationsOf(installed)).toStrictEqual([])

const verifyConsumerEffectIsTheOnlyCopy = (expect: Expect, installed: ReadonlyArray<InstalledPackage>): Check =>
  expect(installedEffectVersionsOf(installed)).toStrictEqual([CONSUMER_EFFECT])

const Feature = makeFeature({ it })

Feature('Running stryker in a project pinned to another effect version')
  .withLayer(E2eHarnessLive)
  .live(
    'installs the packed run-path tarballs beside the consumer effect and runs the packed CLI in a microVM',
  )
  .body(({ scenario }) => {
    scenario(
      'A consumer on effect 4.0.0 completes a mutation run and no run-path package declares effect',
      Gherkin.Do.pipe(
        When('the CLI runs in machine mode in a project that pins effect to 4.0.0')(
          'run',
          () => runStryker({ fixture: CONSUMER_FIXTURE_URL, label: 'effect-separation', args: ['run', '--json'] }),
        ),
        Then('the process exits with success')((s, expect) => expect(s.run.output.result.exitCode).toBe(0)),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        When('the terminal verdict of the decoded stream is read')('verdict', (s) => verdictEvent(s.events)),
        When('the packages npm installed beside the consumer are read')(
          'installed',
          (s) =>
            s.run.output.readFile(INSTALLED_TREE_FILE).pipe(
              Effect.flatMap(Schema.decodeEffect(InstalledTree)),
              Effect.map(installedPackagesOf),
            ),
        ),
        Then('no package reachable from the run-path packages declares effect or is effect')((s, expect) =>
          verifyRunPathHoldsNoEffect(expect, s.installed)
        ),
        Then('the consumer effect is the only effect copy installed')((s, expect) =>
          verifyConsumerEffectIsTheOnlyCopy(expect, s.installed)
        ),
      ),
    )
  })
