import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import { cloneNode, type Comment, type Program, type Statement } from './Ast.js'
import { INSTRUMENTER_CONSTANTS as ID } from './Mutant.js'
import { type ParseFailed, parseWithOxc } from './Parser.js'

interface LocatedComment extends Comment {
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number }
    readonly end: { readonly line: number; readonly column: number }
  }
}
function leadingCommentsOn(value: object): readonly LocatedComment[] | undefined {
  return hasCommentsProp(value) ? narrowComments(value) : undefined
}

const hasCommentsProp = (value: object): value is { readonly leadingComments: Comment[] | undefined } =>
  Predicate.hasProperty(value, 'leadingComments')

const narrowComments = (
  value: { readonly leadingComments: Comment[] | undefined },
): readonly LocatedComment[] | undefined => isCommentHost(value) ? value.leadingComments : undefined

const isCommentHost = (value: { readonly leadingComments: Comment[] | undefined }): boolean =>
  isCommentArray(value.leadingComments)

function isCommentArray(value: unknown): value is readonly LocatedComment[] {
  return Array.isArray(value)
}

export interface HeaderOptions {
  readonly noHeader?: boolean | undefined
}

export const STRYKER_NAMESPACE_HELPER = 'stryNS_9fa48'
export const COVER_MUTANT_HELPER = 'stryCov_9fa48'
export const IS_MUTANT_ACTIVE_HELPER = 'stryMutAct_9fa48'

const INSTRUMENTATION_HEADER_SOURCE = `// @ts-nocheck
var ${STRYKER_NAMESPACE_HELPER} = function(){
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.${ID.NAMESPACE} || (g.${ID.NAMESPACE} = {});
  if (ns.${ID.ACTIVE_MUTANT} === undefined && g.process && g.process.env && g.process.env.${ID.ACTIVE_MUTANT_ENV_VARIABLE}) {
    ns.${ID.ACTIVE_MUTANT} = g.process.env.${ID.ACTIVE_MUTANT_ENV_VARIABLE};
  }
  function retrieveNS(){
    return ns;
  }
  ${STRYKER_NAMESPACE_HELPER} = retrieveNS;
  return retrieveNS();
};
${STRYKER_NAMESPACE_HELPER}();

var ${COVER_MUTANT_HELPER} = function() {
  var ns = ${STRYKER_NAMESPACE_HELPER}();
  var cov = ns.${ID.MUTATION_COVERAGE_OBJECT} || (ns.${ID.MUTATION_COVERAGE_OBJECT} = { static: {}, perTest: {} });
  function cover() {
    var c = cov.static;
    if (ns.${ID.CURRENT_TEST_ID}) {
      c = cov.perTest[ns.${ID.CURRENT_TEST_ID}] = cov.perTest[ns.${ID.CURRENT_TEST_ID}] || {};
    }
    var a = arguments;
    for(var i=0; i < a.length; i++){
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  ${COVER_MUTANT_HELPER} = cover;
  cover.apply(null, arguments);
};
var ${IS_MUTANT_ACTIVE_HELPER} = function(id) {
  var ns = ${STRYKER_NAMESPACE_HELPER}();
  function isActive(id) {
    if (ns.${ID.ACTIVE_MUTANT} === id) {
      if (ns.${ID.HIT_COUNT} !== void 0 && ++ns.${ID.HIT_COUNT} > ns.${ID.HIT_LIMIT}) {
        throw new Error('Stryker: Hit count limit reached (' + ns.${ID.HIT_COUNT} + ')');
      }
      return true;
    }
    return false;
  }
  ${IS_MUTANT_ACTIVE_HELPER} = isActive;
  return isActive(id);
}`

let instrumentationHeaderValue: readonly Statement[] | undefined

const loadHeader = Effect.map(
  parseWithOxc(INSTRUMENTATION_HEADER_SOURCE, 'instrumenter-header.js', 'js'),
  (parsed): readonly Statement[] => {
    instrumentationHeaderValue = parsed.root.body
    deepFreeze(instrumentationHeaderValue)
    return parsed.root.body
  },
)
export const instrumentationHeader: Effect.Effect<readonly Statement[], ParseFailed> =
  instrumentationHeaderValue !== undefined ? Effect.succeed(instrumentationHeaderValue) : loadHeader

export const placeHeader = (root: Program): Effect.Effect<void, ParseFailed> =>
  Effect.map(headerFor(root), (header) => {
    root.body.unshift(...header)
  })

const headerFor = (root: Program): Effect.Effect<readonly Statement[], ParseFailed> =>
  Effect.map(instrumentationHeader, (header) =>
    Option.match(leadingCommentsOf(root), {
      onNone: () => header,
      onSome: (leadingComments) => [commentedHeader(leadingComments, header), ...header.slice(1)],
    }))

export const placeHeaderIfNeeded = (
  placed: boolean,
  options: HeaderOptions,
  root: Program,
): Effect.Effect<void, ParseFailed> => (placed ? placeHeaderWhenWanted(options, root) : Effect.void)

const placeHeaderWhenWanted = (options: HeaderOptions, root: Program): Effect.Effect<void, ParseFailed> =>
  options.noHeader === true ? Effect.void : placeHeader(root)

function leadingCommentsOf(root: Program): Option.Option<readonly LocatedComment[]> {
  return Option.filter(Option.fromNullishOr(leadingCommentsOn(root.body[0] ?? {})), isCommentArray)
}

function commentedHeader(leadingComments: readonly LocatedComment[], header: readonly Statement[]): Statement {
  const firstHeader = Option.getOrThrowWith(
    Option.fromNullishOr(header[0]),
    () => new Error('Instrumentation header is empty'),
  )
  const cloned = cloneNode(firstHeader)
  Object.assign(cloned, { leadingComments })
  return cloned
}

function deepFreeze<A = unknown>(value: A): A {
  return Option.match(frozenContainer(value), {
    onNone: () => value,
    onSome: (frozen) => frozen,
  })
}

function frozenContainer<A = unknown>(value: A): Option.Option<A> {
  return Option.map(Option.filter(Option.some(value), isObjectValue), (object) => {
    freezableChildren(object).forEach((child) => {
      deepFreeze(child)
    })
    Object.freeze(object)
    return value
  })
}

function freezableChildren(value: Record<string, object | null | undefined>): readonly (object | null | undefined)[] {
  return [...mapEntries(value), ...setItems(value), ...Object.values(value)]
}

function mapEntries(value: object): readonly (object | null | undefined)[] {
  return Option.getOrElse(
    Option.map(Option.filter(Option.some(value), isMap), (map) => [...map.entries()].flat()),
    () => NO_CHILDREN,
  )
}
function setItems(value: object): readonly (object | null | undefined)[] {
  return Option.getOrElse(Option.map(Option.filter(Option.some(value), isSet), (set) => [...set]), () => NO_CHILDREN)
}

const NO_CHILDREN: readonly (object | null | undefined)[] = Object.freeze([])

function isObjectValue(value: unknown): value is Record<string, object | null | undefined> {
  return value !== null && typeof value === 'object'
}

function isMap(value: object): value is Map<object | null | undefined, object | null | undefined> {
  return value instanceof Map
}

function isSet(value: object): value is Set<object | null | undefined> {
  return value instanceof Set
}
