import * as S from 'effect/Schema'

export const SarifDocument = S.Struct({
  $schema: S.String,
  version: S.String,
  runs: S.Array(S.Struct({
    tool: S.Struct({
      driver: S.Struct({
        name: S.String,
        informationUri: S.String,
        rules: S.Array(S.Struct({ id: S.String, name: S.String })),
      }),
    }),
    results: S.Array(S.Struct({
      ruleId: S.String,
      ruleIndex: S.Natural,
      level: S.String,
      message: S.Struct({ text: S.String }),
      locations: S.Array(
        S.Struct({
          physicalLocation: S.Struct({
            artifactLocation: S.Struct({ uri: S.String }),
            region: S.Struct({
              startLine: S.Natural,
              startColumn: S.Natural,
              endLine: S.Natural,
              endColumn: S.Natural,
            }),
          }),
        }),
      ),
      partialFingerprints: S.Struct({ primaryLocationLineHash: S.String }),
    })),
  })),
})

export type SarifDocument = typeof SarifDocument.Type

export const FailureSarifDocument = S.Struct({
  version: S.String,
  runs: S.Array(
    S.Struct({
      invocations: S.Array(
        S.Struct({
          executionSuccessful: S.Boolean,
          exitCode: S.Int,
          toolExecutionNotifications: S.Array(
            S.Struct({
              descriptor: S.Struct({ id: S.String }),
              level: S.String,
              message: S.Struct({ text: S.String }),
              locations: S.Array(S.Unknown),
            }),
          ),
        }),
      ),
    }),
  ),
})

export type FailureSarifDocument = typeof FailureSarifDocument.Type

export const ReproducerList = S.Array(
  S.Struct({ id: S.String, fileName: S.String, diff: S.String, command: S.String }),
)

export const AnnotateBaselineFile = S.Struct({
  schemaVersion: S.Natural,
  survivors: S.Array(S.String),
})
