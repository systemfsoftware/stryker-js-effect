import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Span } from '@systemfsoftware/trace-taxonomy'
import * as S from 'effect/Schema'

const declaredFrom = <Attributes extends Readonly<Record<string, S.Codec<Span.AttributeValue>>>>(
  member: { readonly name: string; readonly attributes: Attributes },
) => Span.declare({ id: member.name, name: member.name, attrs: S.Struct(member.attributes) })

export const RpcInit = declaredFrom(SpanTaxonomy.Spans.rpcInit)
export const InstrumentPhase = declaredFrom(SpanTaxonomy.Spans.instrumentPhase)
export const InstrumentGather = declaredFrom(SpanTaxonomy.Spans.instrumentGather)
export const PhaseEntered = declaredFrom(SpanTaxonomy.Spans.phaseEntered)
export const MutantRun = declaredFrom(SpanTaxonomy.Spans.mutantRun)
export const SandboxAcquire = declaredFrom(SpanTaxonomy.Spans.sandboxAcquire)
export const SandboxBuildRun = declaredFrom(SpanTaxonomy.Spans.sandboxBuildRun)
export const SandboxSymlinkNodeModules = declaredFrom(SpanTaxonomy.Spans.sandboxSymlinkNodeModules)
export const SandboxFindNodeModules = declaredFrom(SpanTaxonomy.Spans.sandboxFindNodeModules)
export const SandboxLinkNodeModules = declaredFrom(SpanTaxonomy.Spans.sandboxLinkNodeModules)
export const SandboxRestoreOriginal = declaredFrom(SpanTaxonomy.Spans.sandboxRestoreOriginal)

/** A span only the host run test starts, to hold the call under test. */
export const HostRun = Span.declare({ id: 'host.run', name: 'host.run', attrs: S.Struct({}) })

/** The span the substituted worker starts for the work it begins, as a root span linked to the host span. */
export const LinkedWork = Span.declare({ id: 'worker.async', name: 'worker.async', attrs: S.Struct({}) })
