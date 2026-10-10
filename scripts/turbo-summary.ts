#!/usr/bin/env -S deno run --allow-read
import { readFile } from 'node:fs/promises'
import process from 'node:process'

export type SummaryReading =
  | { readonly kind: 'read'; readonly missed: number; readonly failed: ReadonlyArray<string> }
  | { readonly kind: 'missing'; readonly field: string }

interface Task {
  readonly taskId: string
  readonly hit: boolean
  readonly exitCode: number | null
}

const PLACEHOLDER = '<NONEXISTENT>'

const taskOf = (task: unknown): Task | string | undefined => {
  if (typeof task !== 'object' || task === null) return '.tasks[]'
  if (!('command' in task) || typeof task.command !== 'string') return '.tasks[].command'
  if (task.command === PLACEHOLDER) return undefined
  if (!('taskId' in task) || typeof task.taskId !== 'string') return '.tasks[].taskId'
  if (!('hash' in task) || typeof task.hash !== 'string') return '.tasks[].hash'
  const cache = 'cache' in task ? task.cache : undefined
  if (typeof cache !== 'object' || cache === null || !('status' in cache) || typeof cache.status !== 'string') {
    return '.tasks[].cache.status'
  }
  if (!('execution' in task)) return '.tasks[].execution'
  const execution = task.execution
  if (execution === null) return { taskId: task.taskId, hit: cache.status === 'HIT', exitCode: null }
  if (
    typeof execution !== 'object' || !('exitCode' in execution) || typeof execution.exitCode !== 'number'
  ) {
    return '.tasks[].execution.exitCode'
  }
  return { taskId: task.taskId, hit: cache.status === 'HIT', exitCode: execution.exitCode }
}

export const readSummaries = (summaries: ReadonlyArray<unknown>): SummaryReading => {
  if (summaries.length === 0) return { kind: 'missing', field: '.turbo/runs/*.json (no run summary was written)' }
  const tasks: Array<Task> = []
  for (const summary of summaries) {
    const summaryTasks = typeof summary === 'object' && summary !== null && 'tasks' in summary
      ? summary.tasks
      : undefined
    if (!Array.isArray(summaryTasks)) return { kind: 'missing', field: '.tasks' }
    for (const raw of summaryTasks) {
      const task = taskOf(raw)
      if (typeof task === 'string') return { kind: 'missing', field: task }
      if (task !== undefined) tasks.push(task)
    }
  }
  const failed = new Set(
    tasks.filter((task) => task.exitCode !== null && task.exitCode !== 0).map((task) => task.taskId),
  )
  return { kind: 'read', missed: tasks.filter((task) => !task.hit).length, failed: [...failed].sort() }
}

if (import.meta.main) {
  const summaries = await Promise.all(
    process.argv.slice(2).map(async (path): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))),
  )
  const reading = readSummaries(summaries)
  if (reading.kind === 'missing') {
    process.stdout.write(`missing=${reading.field}\n`)
    process.exitCode = 2
  } else {
    process.stdout.write(`missed=${reading.missed}\nfailed=${reading.failed.join(' ')}\n`)
  }
}
