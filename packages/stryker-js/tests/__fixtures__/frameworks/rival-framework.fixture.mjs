const refuse = () => ({ kind: 'ParseFailed', message: 'the rival fixture parses nothing' })

export const strykerFrameworks = [
  {
    kind: 'Framework',
    name: 'rival-format',
    claim: {
      formatId: 'rival',
      extensions: ['.fixture', '.ts'],
      language: 'rival',
      ownerVersion: '2.0.0',
      contractVersion: '1',
    },
    parse: refuse,
    transform: (document) => document,
    print: (document) => document.rawContent,
    disableTypeChecks: (rawContent) => ({ kind: 'Parsed', value: rawContent }),
  },
]
