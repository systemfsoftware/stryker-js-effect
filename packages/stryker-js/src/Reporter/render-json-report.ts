import * as Boolean from 'effect/Boolean'

export const renderRelativePathNotice = (normalizedFileName: string): string =>
  `Using relative path ${normalizedFileName}\n`

export const renderReportLocationNotice = (href: string): string => `Your report can be found at: ${href}\n`

export const renderDebugNotices = (
  { debug, normalizedFileName }: { readonly debug: boolean; readonly normalizedFileName: string },
): readonly string[] =>
  Boolean.match(debug, {
    onTrue: () => [renderRelativePathNotice(normalizedFileName)],
    onFalse: () => [],
  })
