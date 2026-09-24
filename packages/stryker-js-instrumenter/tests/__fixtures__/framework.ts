import type {
  EmbeddedDocument,
  Framework,
  FrameworkContext,
  FrameworkParseResult,
} from '@systemfsoftware/stryker-framework-interface'

const DOCUMENT = 'before {{ n + 1 }} after'

const regionOf = (rawContent: string, context: FrameworkContext): EmbeddedDocument => {
  const start = rawContent.indexOf('{{')
  const end = rawContent.indexOf('}}') + '}}'.length
  const source = rawContent.slice(start, end)
  return {
    formatId: 'fixture-mini',
    rawContent,
    regions: [{ start, end, isExpression: false, scriptAst: context.parseScript(source, 'js') }],
  }
}

const parsed = <A>(value: A): FrameworkParseResult<A> => ({ kind: 'Parsed', value })

const failed = (message: string): FrameworkParseResult<never> => ({ kind: 'ParseFailed', message })

export const fixtureFramework: Framework = {
  kind: 'Framework',
  name: 'fixture-mini',
  claim: {
    formatId: 'fixture-mini',
    extensions: ['.mini'],
    language: 'fixture',
    ownerVersion: '0.0.0-test',
    contractVersion: '1',
  },
  parse: (rawContent, context) => parsed(regionOf(rawContent, context)),
  transform: (document) => document,
  print: (document) => document.rawContent,
  disableTypeChecks: (rawContent) => {
    const start = rawContent.indexOf('{{')
    if (start < 0) {
      return parsed(rawContent)
    }
    return parsed(`${rawContent.slice(0, start)}// @ts-nocheck\n${rawContent.slice(start)}`)
  },
}

export const failingFramework: Framework = {
  ...fixtureFramework,
  name: 'fixture-failing',
  parse: () => failed('fixture refuses this document'),
}

export const fixtureDocument = DOCUMENT
