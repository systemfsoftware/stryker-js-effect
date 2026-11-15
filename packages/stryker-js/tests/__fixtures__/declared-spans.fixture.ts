import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Span } from '@systemfsoftware/trace-taxonomy'
import * as S from 'effect/Schema'

export const RpcInit = Span.declare({
  id: SpanTaxonomy.Spans.rpcInit.name,
  name: SpanTaxonomy.Spans.rpcInit.name,
  attrs: S.Struct(SpanTaxonomy.Spans.rpcInit.attributes),
})

export const InstrumentPhase = Span.declare({
  id: SpanTaxonomy.Spans.instrumentPhase.name,
  name: SpanTaxonomy.Spans.instrumentPhase.name,
  attrs: S.Struct(SpanTaxonomy.Spans.instrumentPhase.attributes),
})

export const InstrumentGather = Span.declare({
  id: SpanTaxonomy.Spans.instrumentGather.name,
  name: SpanTaxonomy.Spans.instrumentGather.name,
  attrs: S.Struct(SpanTaxonomy.Spans.instrumentGather.attributes),
})

export const PhaseEntered = Span.declare({
  id: SpanTaxonomy.Spans.phaseEntered.name,
  name: SpanTaxonomy.Spans.phaseEntered.name,
  attrs: S.Struct(SpanTaxonomy.Spans.phaseEntered.attributes),
})

export const MutantRun = Span.declare({
  id: SpanTaxonomy.Spans.mutantRun.name,
  name: SpanTaxonomy.Spans.mutantRun.name,
  attrs: S.Struct(SpanTaxonomy.Spans.mutantRun.attributes),
})

export const SandboxAcquire = Span.declare({
  id: SpanTaxonomy.Spans.sandboxAcquire.name,
  name: SpanTaxonomy.Spans.sandboxAcquire.name,
  attrs: S.Struct(SpanTaxonomy.Spans.sandboxAcquire.attributes),
})

export const SandboxBuildRun = Span.declare({
  id: SpanTaxonomy.Spans.sandboxBuildRun.name,
  name: SpanTaxonomy.Spans.sandboxBuildRun.name,
  attrs: S.Struct(SpanTaxonomy.Spans.sandboxBuildRun.attributes),
})

export const SandboxSymlinkNodeModules = Span.declare({
  id: SpanTaxonomy.Spans.sandboxSymlinkNodeModules.name,
  name: SpanTaxonomy.Spans.sandboxSymlinkNodeModules.name,
  attrs: S.Struct(SpanTaxonomy.Spans.sandboxSymlinkNodeModules.attributes),
})

export const SandboxFindNodeModules = Span.declare({
  id: SpanTaxonomy.Spans.sandboxFindNodeModules.name,
  name: SpanTaxonomy.Spans.sandboxFindNodeModules.name,
  attrs: S.Struct(SpanTaxonomy.Spans.sandboxFindNodeModules.attributes),
})

export const SandboxLinkNodeModules = Span.declare({
  id: SpanTaxonomy.Spans.sandboxLinkNodeModules.name,
  name: SpanTaxonomy.Spans.sandboxLinkNodeModules.name,
  attrs: S.Struct(SpanTaxonomy.Spans.sandboxLinkNodeModules.attributes),
})

export const SandboxRestoreOriginal = Span.declare({
  id: SpanTaxonomy.Spans.sandboxRestoreOriginal.name,
  name: SpanTaxonomy.Spans.sandboxRestoreOriginal.name,
  attrs: S.Struct(SpanTaxonomy.Spans.sandboxRestoreOriginal.attributes),
})
