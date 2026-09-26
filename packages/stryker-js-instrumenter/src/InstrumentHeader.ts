import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import { cloneNode, type Program, type Statement } from './Ast.handle.js'
import type { SpannedComment } from './Ast.schema.js'
import { InstrumenterContext } from './Mutant.schema.js'
import { type ParseFailed, parseWithOxc } from './Parser.service.js'

interface LocatedComment extends SpannedComment {
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number }
    readonly end: { readonly line: number; readonly column: number }
  }
}

const hasLeadingComments = (
  value: object | undefined,
): value is { readonly leadingComments: readonly LocatedComment[] } =>
  Predicate.hasProperty(value, 'leadingComments') && Array.isArray(value.leadingComments)

export interface HeaderOptions {
  readonly noHeader?: boolean | undefined
}

export const STRYKER_NAMESPACE_HELPER = 'stryNS_9fa48'
export const COVER_MUTANT_HELPER = 'stryCov_9fa48'
export const IS_MUTANT_ACTIVE_HELPER = 'stryMutAct_9fa48'

const ID = InstrumenterContext

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
    return parsed.root.body
  },
)

export const instrumentationHeader: Effect.Effect<readonly Statement[], ParseFailed> = Option.match(
  Option.fromNullishOr(instrumentationHeaderValue),
  {
    onNone: () => loadHeader,
    onSome: (header) => Effect.succeed(header),
  },
)

export const placeHeader = (root: Program): Effect.Effect<void, ParseFailed> =>
  Effect.map(headerFor(root), (header) => {
    root.body.unshift(...header)
  })

const headerFor = (root: Program): Effect.Effect<readonly Statement[], ParseFailed> =>
  Effect.map(
    instrumentationHeader,
    (header) =>
      Option.match(Option.all([Option.fromNullishOr(header[0]), leadingCommentsOf(root)]), {
        onNone: () => header,
        onSome: ([firstHeader, leadingComments]) => commentedHeader(firstHeader, leadingComments, header.slice(1)),
      }),
  )

const placeHeaderIfNeededDataFirst = (
  placed: boolean,
  options: HeaderOptions,
  root: Program,
): Effect.Effect<void, ParseFailed> =>
  Boolean.match(placed, {
    onTrue: () => placeHeaderWhenWanted(options, root),
    onFalse: () => Effect.void,
  })

export const placeHeaderIfNeeded: {
  (placed: boolean, options: HeaderOptions, root: Program): Effect.Effect<void, ParseFailed>
  (options: HeaderOptions, root: Program): (placed: boolean) => Effect.Effect<void, ParseFailed>
} = dual((args: IArguments): boolean => args.length >= 3, placeHeaderIfNeededDataFirst)

const placeHeaderWhenWanted = (options: HeaderOptions, root: Program): Effect.Effect<void, ParseFailed> =>
  Boolean.match(options.noHeader === true, {
    onTrue: () => Effect.void,
    onFalse: () => placeHeader(root),
  })

function leadingCommentsOf(root: Program): Option.Option<readonly LocatedComment[]> {
  const first = root.body[0]
  return Option.map(Option.liftPredicate(first, hasLeadingComments), (value) => value.leadingComments)
}

function commentedHeader(
  firstHeader: Statement,
  leadingComments: readonly LocatedComment[],
  rest: readonly Statement[],
): readonly Statement[] {
  const cloned = cloneNode(firstHeader)
  Object.assign(cloned, { leadingComments })
  return [cloned, ...rest]
}
