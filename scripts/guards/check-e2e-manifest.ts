#!/usr/bin/env -S deno run --allow-read --allow-run --allow-write=/tmp --allow-env
const LANE_MANIFEST = 'test/e2e/package.json'
const TURBO_MANIFEST = 'turbo.json'
const WITNESS_REGISTRY = 'test/e2e-core/src/witness-registry.ts'
const JOURNEY_DIRECTORY = 'test/e2e/tests/'
const DISABLED_MARKER = /(?:\.(?:skip|skipIf|runIf|only|todo)|\bx(?:it|test|describe))\s*\(/
const JOURNEY_ENTRY = /journey:\s*'([^']+)'/g

const parseObject = (text: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export const laneViolations = (manifestText: string): ReadonlyArray<string> => {
  const manifest = parseObject(manifestText)
  if (manifest === null) return [`${LANE_MANIFEST}: not a JSON object`]
  const scripts = manifest.scripts
  const declaresTest = typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts) &&
    Object.hasOwn(scripts, 'test')
  return declaresTest
    ? [`${LANE_MANIFEST}: declares a "test" script, so the lane would run inside pnpm test`]
    : []
}

export const cacheViolations = (turboText: string): ReadonlyArray<string> => {
  const turbo = parseObject(turboText)
  if (turbo === null) return [`${TURBO_MANIFEST}: not a JSON object`]
  const tasks = turbo.tasks
  const task = typeof tasks === 'object' && tasks !== null && !Array.isArray(tasks)
    ? (tasks as Record<string, unknown>)['test:e2e']
    : undefined
  const declaredUncacheable = typeof task === 'object' && task !== null &&
    (task as Record<string, unknown>).cache === false
  return declaredUncacheable
    ? []
    : [`${TURBO_MANIFEST}: the test:e2e task must declare "cache": false`]
}

export const journeyViolations = (
  journey: string,
  exists: boolean,
  text: string | null,
): ReadonlyArray<string> => {
  if (!journey.startsWith(JOURNEY_DIRECTORY)) {
    return [`${WITNESS_REGISTRY}: names the journey ${journey}, which is outside ${JOURNEY_DIRECTORY}`]
  }
  if (!exists) return [`${WITNESS_REGISTRY}: names the journey ${journey}, which does not exist`]
  if (text !== null && DISABLED_MARKER.test(text)) {
    return [`${WITNESS_REGISTRY}: names the journey ${journey}, which carries a disabled or focused case`]
  }
  return []
}

export const registryJourneys = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(JOURNEY_ENTRY)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]))

const selftest = (): number => {
  const cases: readonly { readonly name: string; readonly run: () => void }[] = [
    {
      name: 'refuses a lane manifest with a test script',
      run: () => {
        const found = laneViolations('{"scripts":{"test":"vitest run","test:e2e":"vitest run"}}')
        if (found.length !== 1) throw new Error(`expected one violation, got ${found.length}`)
        if (!found[0]?.includes('test')) throw new Error(`${found[0]}`)
      },
    },
    {
      name: 'accepts a lane manifest without a test script',
      run: () => {
        const found = laneViolations('{"scripts":{"test:e2e":"vitest run","typecheck":"tsc -b"}}')
        if (found.length !== 0) throw new Error(JSON.stringify(found))
      },
    },
    {
      name: 'refuses a cacheable test:e2e task',
      run: () => {
        const found = cacheViolations('{"tasks":{"test:e2e":{"cache":true}}}')
        if (found.length !== 1) throw new Error(`expected one violation, got ${found.length}`)
        if (!found[0]?.includes('cache')) throw new Error(`${found[0]}`)
      },
    },
    {
      name: 'accepts a non-cacheable test:e2e task',
      run: () => {
        const found = cacheViolations('{"tasks":{"test:e2e":{"cache":false}}}')
        if (found.length !== 0) throw new Error(JSON.stringify(found))
      },
    },
    {
      name: 'refuses a registry journey with no file',
      run: () => {
        const found = journeyViolations('test/e2e/tests/missing.e2e.test.ts', false, null)
        if (found.length !== 1) throw new Error(`expected one violation, got ${found.length}`)
        if (!found[0]?.includes('does not exist')) throw new Error(`${found[0]}`)
      },
    },
    {
      name: 'refuses a registry journey containing .skip',
      run: () => {
        const found = journeyViolations('test/e2e/tests/muted.e2e.test.ts', true, "it.skip('muted', () => {})")
        if (found.length !== 1) throw new Error(`expected one violation, got ${found.length}`)
        if (!found[0]?.includes('disabled')) throw new Error(`${found[0]}`)
      },
    },
    {
      name: 'refuses a registry journey with a conditional or x-prefixed disable',
      run: () => {
        const disabled = [
          "it.skipIf(process.env.CI)('muted', () => {})",
          "describe.runIf(false)('muted', () => {})",
          "xit('muted', () => {})",
          "xdescribe('muted', () => {})",
        ]
        const found = disabled.flatMap((text) => journeyViolations('test/e2e/tests/muted.e2e.test.ts', true, text))
        if (found.length !== disabled.length) {
          throw new Error(`expected ${disabled.length} violations, got ${found.length}`)
        }
      },
    },
    {
      name: 'refuses a registry journey outside the lane',
      run: () => {
        const found = journeyViolations('test/e2e-core/tests/moved.test.ts', true, "it('x', () => {})")
        if (found.length !== 1) throw new Error(`expected one violation, got ${found.length}`)
      },
    },
    {
      name: 'accepts a present, enabled registry journey',
      run: () => {
        const found = journeyViolations('test/e2e/tests/ok.e2e.test.ts', true, "it('ok', () => {})")
        if (found.length !== 0) throw new Error(JSON.stringify(found))
      },
    },
  ]

  let failures = 0
  for (const test of cases) {
    try {
      test.run()
      console.log(`  ✓ ${test.name}`)
    } catch (error) {
      console.error(`  ✗ ${test.name}: ${error instanceof Error ? error.message : String(error)}`)
      failures++
    }
  }

  if (failures > 0) {
    console.error(`check-e2e-manifest: selftest FAILED (${failures}/${cases.length})`)
    return 1
  }
  console.log(`check-e2e-manifest: selftest ok (${cases.length} tests)`)
  return 0
}

const main = async (): Promise<number> => {
  if (Deno.args.includes('--selftest')) return selftest()

  const violations: string[] = [
    ...laneViolations(await Deno.readTextFile(LANE_MANIFEST)),
    ...cacheViolations(await Deno.readTextFile(TURBO_MANIFEST)),
  ]
  const journeys = registryJourneys(await Deno.readTextFile(WITNESS_REGISTRY))
  if (journeys.length === 0) violations.push(`${WITNESS_REGISTRY}: names no journey`)
  for (const journey of journeys) {
    const stat = await Deno.stat(journey).catch(() => null)
    const text = stat !== null && stat.isFile ? await Deno.readTextFile(journey) : null
    violations.push(...journeyViolations(journey, stat !== null, text))
  }

  if (violations.length > 0) {
    for (const violation of violations) console.error(`error[E2E-MANIFEST]: ${violation}`)
    console.error(`check-e2e-manifest: ${violations.length} violation(s)`)
    return 1
  }
  console.log(
    `check-e2e-manifest: the lane declares no test script, test:e2e is not cacheable, and ${journeys.length} registry journey(s) resolve to enabled files`,
  )
  return 0
}

if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (error) {
    console.error(`check-e2e-manifest: error: ${error instanceof Error ? error.message : String(error)}`)
    Deno.exit(1)
  }
}
