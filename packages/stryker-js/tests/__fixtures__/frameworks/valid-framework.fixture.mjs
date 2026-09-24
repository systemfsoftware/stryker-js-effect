const OPEN = '<script>'
const CLOSE = '</script>'

const parseFixture = (rawContent, context) => {
  const open = rawContent.indexOf(OPEN)
  const close = rawContent.indexOf(CLOSE)
  if (open === -1 || close === -1) {
    return { kind: 'ParseFailed', message: 'no <script> region found' }
  }
  const start = open + OPEN.length
  return {
    kind: 'Parsed',
    value: {
      formatId: 'fixture',
      rawContent,
      regions: [
        {
          start,
          end: close,
          isExpression: false,
          scriptAst: context.parseScript(rawContent.slice(start, close), 'js'),
        },
      ],
    },
  }
}

const printFixture = (document, context) => {
  const printed = document.regions.reduce(
    ({ pieces, cursor }, region) => ({
      pieces: [...pieces, document.rawContent.slice(cursor, region.start), context.printScript(region.scriptAst)],
      cursor: region.end,
    }),
    { pieces: [], cursor: 0 },
  )
  return [...printed.pieces, document.rawContent.slice(printed.cursor)].join('')
}

export const strykerFrameworks = [
  {
    kind: 'Framework',
    name: 'fixture-format',
    claim: {
      formatId: 'fixture',
      extensions: ['.fixture'],
      language: 'fixture',
      ownerVersion: '1.0.0',
      contractVersion: '1',
    },
    parse: parseFixture,
    transform: (document) => document,
    print: printFixture,
    disableTypeChecks: (rawContent) => ({ kind: 'Parsed', value: rawContent }),
  },
]
