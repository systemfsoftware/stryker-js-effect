import { Graph, type Rel } from '@systemfsoftware/trace-spec'
import type { Span } from '@systemfsoftware/trace-taxonomy'

type Relation = Rel.Relation

interface Evaluation {
  readonly inspected: ReadonlyArray<string>
  readonly broken: string | undefined
}

/** A relation over the whole decoded graph, for a claim the stock relations do not state. */
const relationOf = (id: string, evaluate: (graph: Graph.TraceGraph) => Evaluation): Relation =>
  Object.assign(
    (graph: Graph.TraceGraph): Rel.Verdict => {
      const { inspected, broken } = evaluate(graph)
      return broken === undefined
        ? { _tag: 'Hold', conjunct: id, inspected }
        : { _tag: 'Break', conjunct: id, inspected, detail: broken }
    },
    { id, soft: false, softenable: false },
  )

const endOf = (node: Graph.GraphNode): number => node.startMillis + node.durationMillis

const within = (node: Graph.GraphNode, outer: Graph.GraphNode): boolean =>
  outer.startMillis <= node.startMillis && endOf(node) <= endOf(outer)

const timedInside = (
  graph: Graph.TraceGraph,
  container: Span.Span,
  spec: Span.Span,
): ReadonlyArray<Graph.GraphNode> => {
  const containers = Graph.byId(graph, container)
  return Graph.byId(graph, spec).filter((node) => containers.some((outer) => within(node, outer)))
}

/**
 * Exactly `count` spans named `spec` start and end within the time of a span named `container`. The run does not
 * parent a phase's work under the phase span, so the phase holds its work by time.
 */
export const withinTimeOfCount = (options: {
  readonly container: Span.Span
  readonly spec: Span.Span
  readonly count: number
}): Relation => {
  const { container, spec, count } = options
  return relationOf(`${count} ${spec.name} span within the time of ${container.name}`, (graph) => {
    const found = timedInside(graph, container, spec)
    return {
      inspected: found.map((node) => node.spanId),
      broken: found.length === count
        ? undefined
        : `found ${found.length} ${spec.name} spans within the time of ${container.name}`,
    }
  })
}

/** At least one span named `spec` starts and ends within the time of a span named `container`. */
export const withinTime = (options: { readonly container: Span.Span; readonly spec: Span.Span }): Relation => {
  const { container, spec } = options
  return relationOf(`${spec.name} within the time of ${container.name}`, (graph) => {
    const found = timedInside(graph, container, spec)
    return {
      inspected: found.map((node) => node.spanId),
      broken: found.length > 0 ? undefined : `no ${spec.name} span within the time of ${container.name}`,
    }
  })
}

/**
 * Every `after` span starts no earlier than the moment every `before` span has ended, and both were emitted. When a
 * `container` is given, both are those within the time of a span named `container`.
 * Times are the trace graph's float milliseconds since the epoch: they keep sub-millisecond digits down to about a
 * quarter of a microsecond, the resolution of a double at that magnitude.
 */
export const finishedBeforeStart = (options: {
  readonly container?: Span.Span
  readonly before: Span.Span
  readonly after: Span.Span
}): Relation =>
  relationOf(`${options.before.name} ends before ${options.after.name} starts`, (graph) => {
    const earlier = options.container === undefined
      ? Graph.byId(graph, options.before)
      : timedInside(graph, options.container, options.before)
    const later = options.container === undefined
      ? Graph.byId(graph, options.after)
      : timedInside(graph, options.container, options.after)
    const late = later.find((node) => earlier.some((first) => endOf(first) > node.startMillis))
    return {
      inspected: [...earlier, ...later].map((node) => node.spanId),
      broken: earlier.length === 0 || later.length === 0
        ? `expected both ${options.before.name} and ${options.after.name} to be emitted`
        : late === undefined
        ? undefined
        : `${options.after.name} ${late.spanId} started before ${options.before.name} ended`,
    }
  })

/**
 * Every span named `child` has `parent` as its nearest ancestor among `watched`, or none of them when `parent` is
 * undefined, and at least one `child` was emitted.
 */
export const nearestWatchedAncestor = (options: {
  readonly watched: ReadonlyArray<Span.Span>
  readonly child: Span.Span
  readonly parent: Span.Span | undefined
}): Relation =>
  relationOf(
    `${options.child.name} sits inside ${options.parent?.name ?? 'no watched span'}`,
    (graph) => {
      const names = new Set(options.watched.map((span) => span.name))
      const byId = new Map(graph.nodes.map((node) => [node.spanId, node] as const))
      const nearestOf = (node: Graph.GraphNode): string => {
        const visited = new Set<string>([node.spanId])
        let parent = byId.get(node.parentSpanId ?? '')
        while (parent !== undefined) {
          if (names.has(parent.name)) return parent.name
          if (visited.has(parent.spanId)) return 'a parent cycle'
          visited.add(parent.spanId)
          parent = byId.get(parent.parentSpanId ?? '')
        }
        return 'nothing'
      }
      const nodes = Graph.byId(graph, options.child)
      const expected = options.parent?.name ?? 'nothing'
      const misplaced = nodes.find((node) => nearestOf(node) !== expected)
      return {
        inspected: nodes.map((node) => node.spanId),
        broken: nodes.length === 0
          ? `no ${options.child.name} span was emitted`
          : misplaced === undefined
          ? undefined
          : `${options.child.name} ${misplaced.spanId} sits inside ${nearestOf(misplaced)}, not ${expected}`,
      }
    },
  )
