import * as S from 'effect/Schema'

export const LiteralSource = S.TaggedStruct('LiteralSource', {
  specifier: S.String,
  literalType: S.Literals(['Literal', 'StringLiteral']),
  valueless: S.Boolean,
})

export const DrawnSource = S.Union([
  LiteralSource,
  S.TaggedStruct('TemplateSource', { text: S.String, withExpression: S.Boolean }),
  S.TaggedStruct('IdentifierSource', { name: S.String }),
])
export type DrawnSource = typeof DrawnSource.Type

const Depth = S.Int.check(S.isBetween({ minimum: 0, maximum: 3 }))

const Container = S.Literals(['array', 'function'])
export type Container = typeof Container.Type

export const RecognisedForm = S.TaggedStruct('RecognisedForm', {
  kind: S.Literals([
    'ImportDeclaration',
    'ExportNamedDeclaration',
    'ExportAllDeclaration',
    'ImportExpression',
    'require',
    'vi',
    'vitest',
  ]),
  method: S.Literals(['doMock', 'importActual', 'importMock', 'mock', 'unmock']),
  source: DrawnSource,
  depth: Depth,
  container: Container,
})
export type RecognisedForm = typeof RecognisedForm.Type

export const DecoyForm = S.TaggedStruct('DecoyForm', {
  kind: S.Literals(['otherCall', 'otherVitestMethod', 'memberRequire', 'jestMock', 'bareExport', 'argumentless']),
  source: DrawnSource,
  depth: Depth,
  container: Container,
})
export type DecoyForm = typeof DecoyForm.Type

export const DrawnProgram = S.Array(S.Union([RecognisedForm, DecoyForm]))
export type DrawnProgram = typeof DrawnProgram.Type
