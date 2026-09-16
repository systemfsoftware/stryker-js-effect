import { INSTRUMENTER_CONSTANTS as ID } from '@systemfsoftware/stryker-js-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import { cloneNode, programFromParseResult, type Statement } from './Ast.js'
import { parseWithOxc } from './Parser.js'

const STRYKER_NAMESPACE_HELPER = 'stryNS_9fa48'
export const COVER_MUTANT_HELPER = 'stryCov_9fa48'
export const IS_MUTANT_ACTIVE_HELPER = 'stryMutAct_9fa48'

const INSTRUMENTATION_RUNTIME_SOURCE = `// @ts-nocheck
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

const parseRuntime = async (): Promise<readonly Statement[]> => {
  const parsed = await parseWithOxc(INSTRUMENTATION_RUNTIME_SOURCE, 'instrumenter-header.js', 'js')
  return programFromParseResult(parsed.root).body
}

let cachedHeader: Option.Option<readonly Statement[]> = Option.none()

export const clonedHeader = async (): Promise<readonly Statement[]> =>
  (await Option.match(cachedHeader, {
    onSome: (header) => header,
    onNone: async (): Promise<readonly Statement[]> => {
      const header = await parseRuntime()
      cachedHeader = Option.some(header)
      return header
    },
  })).map((statement) => cloneNode(statement))

export const shouldPlaceHeader = (hasLiveMutants: boolean, noHeader: boolean | undefined): boolean =>
  Match.value(hasLiveMutants).pipe(
    Match.when(true, () => noHeader !== true),
    Match.orElse(() => false),
  )
