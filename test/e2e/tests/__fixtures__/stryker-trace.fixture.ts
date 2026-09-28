import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Contract, Rel } from '@systemfsoftware/trace-spec'
import { Span, Taxonomy } from '@systemfsoftware/trace-taxonomy'
import { Schema } from 'effect'

import { StrykerRun } from './e2e-harness.fixture.js'

export const strykerCliRun = Span.declare({
  id: SpanTaxonomy.Spans.cliRun.name,
  name: SpanTaxonomy.Spans.cliRun.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.cliRun.attributes),
})

export const prepare = Span.declare({
  id: SpanTaxonomy.Spans.preparePhase.name,
  name: SpanTaxonomy.Spans.preparePhase.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.preparePhase.attributes),
})

export const instrument = Span.declare({
  id: SpanTaxonomy.Spans.instrumentPhase.name,
  name: SpanTaxonomy.Spans.instrumentPhase.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.instrumentPhase.attributes),
})

export const dryRun = Span.declare({
  id: SpanTaxonomy.Spans.dryRunPhase.name,
  name: SpanTaxonomy.Spans.dryRunPhase.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.dryRunPhase.attributes),
})

export const mutationTest = Span.declare({
  id: SpanTaxonomy.Spans.mutationTestPhase.name,
  name: SpanTaxonomy.Spans.mutationTestPhase.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.mutationTestPhase.attributes),
})

export const mutationTestBatch = Span.declare({
  id: SpanTaxonomy.Spans.mutationTestBatch.name,
  name: SpanTaxonomy.Spans.mutationTestBatch.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.mutationTestBatch.attributes),
})

export const checkerCheck = Span.declare({
  id: SpanTaxonomy.Spans.checkerCheck.name,
  name: SpanTaxonomy.Spans.checkerCheck.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.checkerCheck.attributes),
})

export const rpcCheck = Span.declare({
  id: SpanTaxonomy.Spans.rpcCheck.name,
  name: SpanTaxonomy.Spans.rpcCheck.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.rpcCheck.attributes),
})

export const rpcGroup = Span.declare({
  id: SpanTaxonomy.Spans.rpcGroup.name,
  name: SpanTaxonomy.Spans.rpcGroup.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.rpcGroup.attributes),
})

export const rpcCapabilities = Span.declare({
  id: SpanTaxonomy.Spans.rpcCapabilities.name,
  name: SpanTaxonomy.Spans.rpcCapabilities.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.rpcCapabilities.attributes),
})

export const rpcDryRun = Span.declare({
  id: SpanTaxonomy.Spans.rpcDryRun.name,
  name: SpanTaxonomy.Spans.rpcDryRun.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.rpcDryRun.attributes),
})

export const rpcMutantRun = Span.declare({
  id: SpanTaxonomy.Spans.rpcMutantRun.name,
  name: SpanTaxonomy.Spans.rpcMutantRun.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.rpcMutantRun.attributes),
})

export const rpcClientCheck = Span.declare({
  id: SpanTaxonomy.Spans.rpcClientCheck.name,
  name: SpanTaxonomy.Spans.rpcClientCheck.name,
  attrs: Schema.Struct(SpanTaxonomy.Spans.rpcClientCheck.attributes),
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
    Rel.descendant(mutationTestBatch, rpcCheck),
    Rel.descendant(mutationTestBatch, rpcGroup),
    Rel.descendant(mutationTestBatch, rpcMutantRun),
    Rel.descendant(strykerCliRun, rpcCapabilities),
    Rel.descendant(strykerCliRun, rpcDryRun),
    Rel.descendant(checkerCheck, rpcClientCheck),
  ))
