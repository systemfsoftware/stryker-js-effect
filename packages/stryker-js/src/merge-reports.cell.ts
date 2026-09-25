import { Sandwich } from '@systemfsoftware/effect-cell-types'

import { mergeReportParts } from './merge-report-parts.workflow.js'
import { encodeMerge, failReason, readMerge, refusalText, writeEncoded } from './merge-reports.parts.js'

export const mergeReportsCell = Sandwich.named('stryker.merge_reports')(readMerge)
  .decide(mergeReportParts)
  .write({
    MergedReports: (merged, raw) =>
      writeEncoded({
        body: encodeMerge({ decoded: raw, rows: merged.rows, survivors: merged.survivors, report: merged.report }),
        raw,
      }),
    NoMergedReports: (absent, raw) =>
      writeEncoded({
        body: encodeMerge({ decoded: raw, rows: absent.rows, survivors: [], report: undefined }),
        raw,
      }),
    DuplicatePackageLabel: (error, raw) => failReason(refusalText({ error, partsDir: raw.partsDir })),
    MissingPackages: (error, raw) => failReason(refusalText({ error, partsDir: raw.partsDir })),
    CommandRejected: ({ issue }, raw) => failReason(`invalid merge command under ${raw.partsDir}: ${issue}`),
  })
