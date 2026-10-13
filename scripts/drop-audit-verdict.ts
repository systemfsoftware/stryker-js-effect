#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write
import { access, appendFile } from 'node:fs/promises'
import process from 'node:process'

export interface StepResult {
  readonly outcome: string
  readonly outputs: Readonly<Record<string, string>>
}

export type Steps = Readonly<Record<string, StepResult>>

export interface Run {
  readonly runId: string
  readonly repository: string
  readonly runNumber: string
  readonly projects: ReadonlyArray<string>
  readonly matrixDir: string
  readonly matrixArtifact: string
  readonly auditOut: string
  readonly killMatrix: string
}

export interface Verdict {
  readonly reason: string
  readonly next: string
}

export type MatrixReason = 'MATRIX_MISSING' | 'MATRIX_NOT_DOWNLOADED' | 'MATRIX_INCOMPLETE'

export const JOB_ORDER: ReadonlyArray<string> = [
  'start',
  'checkout',
  'build-key',
  'pnpm',
  'node',
  'tarballs',
  'install',
  'restore',
  'matrix-check',
  'build',
  'audit',
  'audit-summary',
  'upload',
]
const OUTSIDE_THE_VERDICT: Readonly<Record<string, true>> = { download: true, verdict: true }
const FAILED_OUTCOME: Readonly<Record<string, true>> = { failure: true, cancelled: true }
const DISPATCH = 'gh workflow run mutation.yml --ref main -f lane=kill-matrix'

export const matrixReasonOf = (
  killMatrix: string,
  downloaded: boolean,
  absent: ReadonlyArray<string>,
): MatrixReason | undefined => {
  if (killMatrix !== 'success') return 'MATRIX_MISSING'
  if (!downloaded) return 'MATRIX_NOT_DOWNLOADED'
  return absent.length > 0 ? 'MATRIX_INCOMPLETE' : undefined
}

export const firstFailedStep = (steps: Steps): { readonly id: string; readonly outcome: string } | undefined => {
  const unlisted = Object.keys(steps).filter((id) => !JOB_ORDER.includes(id) && OUTSIDE_THE_VERDICT[id] !== true)
  for (const id of [...JOB_ORDER, ...unlisted]) {
    const outcome = steps[id]?.outcome
    if (outcome !== undefined && FAILED_OUTCOME[outcome] === true) return { id, outcome }
  }
  return undefined
}

export const verdictOf = (steps: Steps, run: Run): Verdict => {
  const fetch = `gh run download ${run.runId} -R ${run.repository} -n ${run.matrixArtifact} -D ${run.matrixDir}`
  const filters = [...new Set(['packages/stryker-js', ...run.projects])].sort().map((project) =>
    `--filter=./${project}`
  )
  const build = `pnpm install --frozen-lockfile && pnpm exec turbo run build ${filters.join(' ')}`
  const audit = `node packages/stryker-js/dist/main.mjs audit --matrix ${run.matrixDir} --projects ${
    run.projects.join(',')
  } --out ${run.auditOut}`
  const rerun = `gh run rerun ${run.runId} -R ${run.repository} --failed`
  const check = `KILL_MATRIX=success MATRIX_DIR=${run.matrixDir} PROJECTS=${
    run.projects.join(',')
  } node scripts/drop-audit-verdict.ts matrix-check`
  const failed = firstFailedStep(steps)
  if (failed === undefined) return { reason: 'DROP_AUDIT_OK', next: '' }
  if (failed.outcome === 'cancelled') {
    return {
      reason: 'DROP_AUDIT_TIMED_OUT',
      next:
        `Step ${failed.id} was cancelled: the run was cancelled or the job hit its 60-minute backstop. Next action: ${rerun}.`,
    }
  }
  const outputs = steps[failed.id]?.outputs ?? {}
  switch (failed.id) {
    case 'install':
      return {
        reason: 'DROP_AUDIT_INSTALL_FAILED',
        next: 'Step install failed. Reproduce with: pnpm install --frozen-lockfile',
      }
    case 'matrix-check':
      switch (outputs['reason']) {
        case 'MATRIX_MISSING':
          return {
            reason: 'MATRIX_MISSING',
            next:
              `The kill-matrix lane of this run ended '${run.killMatrix}', so it published no ${run.matrixArtifact}. The failing gate is that lane's failed job (kill-matrix · plan, build, a shard or collect), whose own annotation names its cause; mutation runs only in CI, so the lane is reproduced by dispatching it. Next action: fix that cause, then ${DISPATCH}.`,
          }
        case 'MATRIX_NOT_DOWNLOADED':
          return {
            reason: 'MATRIX_NOT_DOWNLOADED',
            next:
              `The kill-matrix lane passed but ${run.matrixArtifact} did not download. Either its plan job planned no shard (count 0: the corpus has no mutant to grade, so collect was skipped and published nothing) or the download failed. Reproduce with: ${fetch} (it succeeds only if the artifact exists). Next action: if it succeeds, ${rerun}; if it finds no artifact, read the kill-matrix plan job's plan.json artifact and fix the mutate globs that select nothing.`,
          }
        case 'MATRIX_INCOMPLETE':
          return {
            reason: 'MATRIX_INCOMPLETE',
            next: `${run.matrixArtifact} has no kill matrix for ${
              outputs['absent'] ?? 'a corpus project'
            }, so it does not cover the corpus. Next action: make both projects defaults in .github/workflows/kill-matrix.yml equal mutation.yml's PROJECTS, then ${DISPATCH}. Reproduce with: ${fetch} && ${check}`,
          }
        default:
          return {
            reason: 'DROP_AUDIT_UNCLASSIFIED',
            next:
              `Step matrix-check failed without writing a reason. Next action: open step matrix-check of this job. Reproduce with: ${fetch} && ${check}`,
          }
      }
    case 'build':
      return {
        reason: 'DROP_AUDIT_BUILD_FAILED',
        next: `A build task of the audited projects failed. Reproduce with: ${build}`,
      }
    case 'audit': {
      const reproduce = `Reproduce with: ${fetch} && ${build} && ${audit}`
      switch (outputs['status']) {
        case '1':
          return {
            reason: 'DROP_AUDIT_FAILED',
            next:
              `stryker audit exited 1: a Fail line in the audit output above (and artifact drop-audit-${run.runNumber}) names a dropped mutant whose dominator has a killer the dropped mutant lacks. ${reproduce}`,
          }
        case '2':
          return {
            reason: 'DROP_AUDIT_REFUSED',
            next:
              `stryker audit exited 2: it refused its input, and its refusal line is in the audit output above. Next action: fix the kill matrix or the projects list it names. ${reproduce}`,
          }
        default:
          return {
            reason: 'DROP_AUDIT_UNCLASSIFIED',
            next: `stryker audit exited ${
              outputs['status'] ?? 'with no recorded status'
            }, outside its exit classes 1 (a drop failed) and 2 (refused input): an interrupt or a crash. ${reproduce}`,
          }
      }
    }
    case 'upload':
      return {
        reason: 'DROP_AUDIT_UPLOAD_FAILED',
        next: `The audit passed but drop-audit-${run.runNumber} did not upload. Next action: ${rerun}.`,
      }
    default:
      return {
        reason: 'DROP_AUDIT_UNCLASSIFIED',
        next:
          `Setup step ${failed.id} failed; it is outside this job's reason table. Next action: open step ${failed.id} of this job, then ${rerun}.`,
      }
  }
}

const stepOf = (value: unknown): StepResult | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const outcome = 'outcome' in value ? value.outcome : undefined
  if (typeof outcome !== 'string') return undefined
  const raw = 'outputs' in value && typeof value.outputs === 'object' && value.outputs !== null ? value.outputs : {}
  const outputs = Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  return { outcome, outputs }
}

export const stepsOf = (json: string): Steps => {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('STEPS is not a JSON object')
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([id, value]) => {
      const step = stepOf(value)
      return step === undefined ? [] : [[id, step]]
    }),
  )
}

const env = (name: string): string => process.env[name] ?? ''

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const writeOutput = async (text: string): Promise<void> => {
  const output = env('GITHUB_OUTPUT')
  if (output) await appendFile(output, text)
}

if (import.meta.main) {
  const run: Run = {
    runId: env('GITHUB_RUN_ID'),
    repository: env('GITHUB_REPOSITORY'),
    runNumber: env('GITHUB_RUN_NUMBER'),
    projects: env('PROJECTS').split(',').map((project) => project.trim()).filter((project) => project !== ''),
    matrixDir: env('MATRIX_DIR'),
    matrixArtifact: env('MATRIX_ARTIFACT'),
    auditOut: env('AUDIT_OUT'),
    killMatrix: env('KILL_MATRIX'),
  }
  const mode = process.argv[2]
  if (mode === 'matrix-check') {
    const downloaded = env('DOWNLOAD') !== 'failure' && await exists(run.matrixDir)
    const absent: Array<string> = []
    for (const project of run.projects) {
      if (!await exists(`${run.matrixDir}/${project}/stryker-incremental.json`)) absent.push(project)
    }
    const reason = matrixReasonOf(run.killMatrix, downloaded, absent)
    if (reason !== undefined) {
      await writeOutput(`reason=${reason}\n${reason === 'MATRIX_INCOMPLETE' ? `absent=${absent.join(',')}\n` : ''}`)
      process.stdout.write(`${reason}\n`)
      process.exitCode = 1
    }
  } else if (mode === 'verdict') {
    const verdict = verdictOf(stepsOf(env('STEPS') || '{}'), run)
    await writeOutput(`reason=${verdict.reason}\nnext<<NEXT_EOF\n${verdict.next}\nNEXT_EOF\n`)
    process.stdout.write(`${verdict.reason}\n`)
  } else {
    process.stderr.write('usage: drop-audit-verdict.ts matrix-check | verdict\n')
    process.exitCode = 2
  }
}
