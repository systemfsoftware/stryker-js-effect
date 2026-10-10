import fc from 'fast-check'
import { laneOf, pathsOf, summaryOf } from './change-lane.ts'

const segment = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,11}$/)
const directories = fc.array(segment, { maxLength: 3 }).map((parts) => parts.map((part) => `${part}/`).join(''))

const docPath = fc.oneof(
  fc.constantFrom('README.md', 'AGENTS.md', 'STRATEGY.md'),
  fc.tuple(directories, segment).map(([directory, name]) => `docs/${directory}${name}.md`),
)

const nonDocPath = fc.oneof(
  fc.tuple(directories, segment, fc.constantFrom('ts', 'yml', 'json', 'html', 'MD', 'mdx')).map(
    ([directory, name, extension]) => `docs/${directory}${name}.${extension}`,
  ),
  fc.tuple(
    fc.constantFrom('.changeset/', '.github/workflows/', 'packages/stryker-js/', 'xdocs/', 'test/e2e/docs/'),
    directories,
    segment,
  ).map(([root, directory, name]) => `${root}${directory}${name}.md`),
  fc.constantFrom('README.MD', 'Readme.md', 'README.md.bak', 'docs', 'CONSTITUTION.md', 'package.json', 'flake.lock'),
  fc.tuple(fc.constantFrom('README.md', 'AGENTS.md', 'STRATEGY.md'), segment).map(([name, directory]) =>
    `${directory}/${name}`
  ),
)

const docsOnlyDiff = fc.array(docPath, { minLength: 1, maxLength: 20 })

const mixedDiff = fc
  .tuple(fc.array(docPath, { maxLength: 20 }), nonDocPath, fc.nat())
  .map(([docs, code, at]) => docs.toSpliced(at % (docs.length + 1), 0, code))

const otherEvent = fc.oneof(
  fc.constantFrom('push', 'workflow_dispatch', 'schedule', 'pull_request_target', 'merge_group', ''),
  segment.filter((event) => event !== 'pull_request'),
)

Deno.test('a pull request whose diff is only docs takes the docs-only lane and lists every file', () => {
  fc.assert(
    fc.property(docsOnlyDiff, (paths) => {
      const decision = laneOf('pull_request', paths)
      const summary = summaryOf(decision)
      return decision.lane === 'docs-only' &&
        summary.startsWith('docs-only: heavy lanes skipped') &&
        paths.every((path) => summary.includes(`- \`${path}\``))
    }),
  )
})

Deno.test('one non-doc path anywhere in a pull request diff runs every lane', () => {
  fc.assert(
    fc.property(mixedDiff, (paths) => {
      const decision = laneOf('pull_request', paths)
      return decision.lane === 'full' && summaryOf(decision).startsWith('full: every lane runs')
    }),
  )
})

Deno.test('every event other than pull_request runs every lane, even for a docs-only diff', () => {
  fc.assert(
    fc.property(otherEvent, fc.oneof(docsOnlyDiff, mixedDiff), (event, paths) => laneOf(event, paths).lane === 'full'),
  )
})

Deno.test('an empty pull request diff runs every lane', () => {
  if (laneOf('pull_request', []).lane !== 'full') throw new Error('an empty diff must take the full lane')
})

Deno.test('NUL-separated git output decodes to the same paths', () => {
  fc.assert(
    fc.property(fc.array(fc.oneof(docPath, nonDocPath)), fc.boolean(), (paths, trailing) => {
      const decoded = pathsOf(paths.join('\0') + (trailing && paths.length > 0 ? '\0' : ''))
      return decoded.length === paths.length && decoded.every((path, index) => path === paths[index])
    }),
  )
})
