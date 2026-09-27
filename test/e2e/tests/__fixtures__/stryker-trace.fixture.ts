import { Contract, Rel } from '@systemfsoftware/trace-spec'
import { Span, Taxonomy } from '@systemfsoftware/trace-taxonomy'
import { Schema } from 'effect'

import { StrykerRun } from './e2e-harness.fixture.js'

const NoAttributes = Schema.Struct({})

export const strykerCliRun = Span.declare({
  id: 'stryker.cli.run',
  name: 'stryker.cli.run',
  attrs: Schema.Struct({
    'stryker.run.outcome': Schema.String,
    'stryker.run.exit_code': Schema.Finite,
    'stryker.run.error': Schema.String,
  }),
})

export const prepare = Span.declare({
  id: 'prepare',
  name: 'prepare',
  attrs: NoAttributes,
})

export const instrument = Span.declare({
  id: 'instrument',
  name: 'instrument',
  attrs: Schema.Struct({ fileCount: Schema.Finite }),
})

export const dryRun = Span.declare({
  id: 'dryRun',
  name: 'dryRun',
  attrs: NoAttributes,
})

export const mutationTest = Span.declare({
  id: 'mutationTest',
  name: 'mutationTest',
  attrs: Schema.Struct({
    mutantCount: Schema.Finite,
    skippedMutantCount: Schema.Finite,
    testCount: Schema.Finite,
  }),
})

export const mutationTestBatch = Span.declare({
  id: 'mutationTest.batch',
  name: 'mutationTest.batch',
  attrs: Schema.Struct({ total: Schema.Finite, testRunners: Schema.Finite }),
})

export const checkerCheck = Span.declare({
  id: 'stryker.checker.check',
  name: 'stryker.checker.check',
  attrs: Schema.Struct({
    'stryker.checker.name': Schema.String,
    'stryker.mutants.count': Schema.Finite,
  }),
})

const RpcMethod = Schema.Struct({ 'rpc.method': Schema.String })

export const rpcCheck = Span.declare({ id: 'rpc.check', name: 'rpc.check', attrs: RpcMethod })
export const rpcGroup = Span.declare({ id: 'rpc.group', name: 'rpc.group', attrs: RpcMethod })
export const rpcCapabilities = Span.declare({
  id: 'rpc.capabilities',
  name: 'rpc.capabilities',
  attrs: RpcMethod,
})
export const rpcDryRun = Span.declare({ id: 'rpc.dryRun', name: 'rpc.dryRun', attrs: RpcMethod })
export const rpcMutantRun = Span.declare({ id: 'rpc.mutantRun', name: 'rpc.mutantRun', attrs: RpcMethod })
export const rpcClientCheck = Span.declare({
  id: 'RpcClient.check',
  name: 'RpcClient.check',
  attrs: NoAttributes,
})

export const strykerLifecycleTaxonomy = Taxonomy.make('stryker-e2e-lifecycle').pipe(
  Taxonomy.add(strykerCliRun),
  Taxonomy.add(prepare),
  Taxonomy.add(instrument),
  Taxonomy.add(dryRun),
  Taxonomy.add(mutationTest),
  Taxonomy.add(mutationTestBatch),
  Taxonomy.add(checkerCheck),
  Taxonomy.add(rpcCheck),
  Taxonomy.add(rpcGroup),
  Taxonomy.add(rpcCapabilities),
  Taxonomy.add(rpcDryRun),
  Taxonomy.add(rpcMutantRun),
  Taxonomy.add(rpcClientCheck),
)

export const strykerLifecycleContract = Contract.of(strykerLifecycleTaxonomy)
  .stimulate(StrykerRun)
  .holds(Rel.all(
    Rel.exists(strykerCliRun),
    Rel.exists(prepare),
    Rel.exists(instrument),
    Rel.exists(dryRun),
    Rel.exists(mutationTest),
    Rel.exists(mutationTestBatch),
    Rel.exists(checkerCheck),
    Rel.exists(rpcCheck),
    Rel.exists(rpcGroup),
    Rel.exists(rpcCapabilities),
    Rel.exists(rpcDryRun),
    Rel.exists(rpcMutantRun),
    Rel.exists(rpcClientCheck),
    Rel.descendant(strykerCliRun, prepare),
    Rel.descendant(strykerCliRun, instrument),
    Rel.descendant(strykerCliRun, dryRun),
    Rel.descendant(strykerCliRun, mutationTest),
    Rel.descendant(strykerCliRun, mutationTestBatch),
    Rel.descendant(mutationTest, rpcCheck),
    Rel.descendant(mutationTest, rpcGroup),
    Rel.descendant(mutationTestBatch, rpcMutantRun),
    Rel.descendant(strykerCliRun, rpcCapabilities),
    Rel.descendant(strykerCliRun, rpcDryRun),
    Rel.descendant(checkerCheck, rpcClientCheck),
  ))
