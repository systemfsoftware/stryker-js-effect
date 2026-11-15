import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Graph, type Rel } from '@systemfsoftware/trace-spec'
import { Span, Taxonomy } from '@systemfsoftware/trace-taxonomy'
import * as S from 'effect/Schema'

/** One labelled checker run the test starts, so a contract can tell the runs of one stimulus apart. */
export const CheckRun = Span.declare({
  id: 'importer_shortcut_test.check_run',
  name: 'importer_shortcut_test.check_run',
  attrs: S.Struct({ label: S.String }),
})

export const CompilerCheck = Span.declare({
  id: SpanTaxonomy.Spans.typescriptCheckerCompilerCheck.name,
  name: SpanTaxonomy.Spans.typescriptCheckerCompilerCheck.name,
  attrs: S.Struct(SpanTaxonomy.Spans.typescriptCheckerCompilerCheck.attributes),
})

export const CheckerRuns = Taxonomy.make('importer-shortcut-checker-runs').pipe(
  Taxonomy.add(CheckRun),
  Taxonomy.descendant(CheckRun, CompilerCheck),
)

/**
 * What the last compiler check of a run records. `counts` is the exact set of importer shortcut counts, keyed
 * without the attribute prefix; the other fields are checked only when given.
 */
export interface ShortcutRecord {
  readonly counts?: Readonly<Record<string, number>>
  readonly snapshotUpdates?: number
  readonly resplices?: number
}

const SHORTCUT_PREFIX = 'typescript.importer_shortcut.'

const sortedEntries = (counts: Readonly<Record<string, number>>): ReadonlyArray<readonly [string, number]> =>
  Object.entries(counts).toSorted(([left], [right]) => left.localeCompare(right))

const shortcutCountsOf = (attrs: Graph.GraphNode['attrs']): Readonly<Record<string, number>> =>
  Object.fromEntries(
    Object.entries(attrs)
      .filter(([key]) => key.startsWith(SHORTCUT_PREFIX))
      .map(([key, value]) => [key.slice(SHORTCUT_PREFIX.length), Number(value)]),
  )

const briefOf = (record: ShortcutRecord): string => JSON.stringify(record)

const brokenRecord = (
  label: string,
  expected: ShortcutRecord,
  graph: Graph.TraceGraph,
): { readonly inspected: ReadonlyArray<string>; readonly broken: string | undefined } => {
  const runs = Graph.byId(graph, CheckRun).filter((node) => node.attrs['label'] === label)
  const [run] = runs
  if (runs.length !== 1 || run === undefined) {
    return { inspected: runs.map((node) => node.spanId), broken: `expected one check run labelled ${label}, found ${runs.length}` }
  }
  const [last] = Graph.descendants(graph, run)
    .filter((node) => node.name === CompilerCheck.name)
    .toSorted((left, right) => right.startMillis + right.durationMillis - (left.startMillis + left.durationMillis))
  if (last === undefined) {
    return { inspected: [run.spanId], broken: `check run ${label} recorded no ${CompilerCheck.name} span` }
  }
  const seen: ShortcutRecord = {
    counts: shortcutCountsOf(last.attrs),
    snapshotUpdates: Number(last.attrs['typescript.snapshot_updates.count'] ?? -1),
    resplices: Number(last.attrs['typescript.resplices.count'] ?? -1),
  }
  const mismatches = [
    expected.counts !== undefined &&
      JSON.stringify(sortedEntries(expected.counts)) !== JSON.stringify(sortedEntries(seen.counts ?? {})),
    expected.snapshotUpdates !== undefined && expected.snapshotUpdates !== seen.snapshotUpdates,
    expected.resplices !== undefined && expected.resplices !== seen.resplices,
  ]
  return {
    inspected: [run.spanId, last.spanId],
    broken: mismatches.some(Boolean)
      ? `check run ${label} expected ${briefOf(expected)} but its last compiler check recorded ${briefOf(seen)}`
      : undefined,
  }
}

/** Every labelled run's last compiler check records what the run was expected to record. */
export const recordsShortcuts = (expected: Readonly<Record<string, ShortcutRecord>>): Rel.Relation => {
  const id = `last compiler check of ${Object.keys(expected).join(', ')} records its shortcut counts`
  return Object.assign(
    (graph: Graph.TraceGraph): Rel.Verdict => {
      const findings = Object.entries(expected).map(([label, record]) => brokenRecord(label, record, graph))
      const inspected = findings.flatMap((finding) => finding.inspected)
      const broken = findings.flatMap((finding) => finding.broken === undefined ? [] : [finding.broken])
      return broken.length === 0
        ? { _tag: 'Hold', conjunct: id, inspected }
        : { _tag: 'Break', conjunct: id, inspected, detail: broken.join('; ') }
    },
    { id, soft: false, softenable: false },
  )
}
