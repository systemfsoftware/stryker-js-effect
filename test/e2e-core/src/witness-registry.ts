import type { WitnessRegistry } from './closure.schema.js'

/**
 * The authored witness registry (KTD17): each status the product ships names the one journey that witnesses it on
 * the packed CLI. Lane shards run as separate jobs, so no process sees every run and each status gets exactly one
 * journey; `waivers` stays empty because this wave produces NoCoverage and Pending and no waiver may cover them.
 */
export const witnessRegistry: WitnessRegistry = {
  witnesses: [
    { status: 'Killed', journey: 'test/e2e/tests/mutation-run.e2e.test.ts' },
    { status: 'Survived', journey: 'test/e2e/tests/svelte-app.e2e.test.ts' },
    { status: 'Timeout', journey: 'test/e2e/tests/enterprise-runner-resilience.e2e.test.ts' },
    { status: 'CompileError', journey: 'test/e2e/tests/enterprise-composite-checker-renamed.e2e.test.ts' },
    { status: 'RuntimeError', journey: 'test/e2e/tests/enterprise-mutation-lifecycle.e2e.test.ts' },
    { status: 'Ignored', journey: 'test/e2e/tests/enterprise-mutation-lifecycle.e2e.test.ts' },
    { status: 'NoCoverage', journey: 'test/e2e/tests/enterprise-mutation-lifecycle.e2e.test.ts' },
    { status: 'Pending', journey: 'test/e2e/tests/enterprise-runner-resilience.e2e.test.ts' },
  ],
  waivers: [],
}
