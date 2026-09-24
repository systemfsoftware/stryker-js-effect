import * as Effect from 'effect/Effect'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

import type { VmRunRequest, VmRunResponse, VmSessionOptions, VmWorkerResponse } from './vm-protocol.schema.js'

export interface VmWorkerClient {
  readonly run: (request: VmRunRequest) => Promise<VmRunResponse>
  readonly terminate: () => Promise<void>
}

export interface VmWorkerClientHooks {
  readonly onExit?: (() => void) | undefined
}

interface Waiting {
  readonly resolve: (response: VmRunResponse) => void
  readonly reject: (cause: Error) => void
}

const workerEntryUrl = (): string =>
  createRequire(import.meta.url).resolve('@systemfsoftware/stryker-vm-harness/worker')

const keepRejectionObserved = <A = unknown>(promise: Promise<A>): Promise<A> => {
  promise.catch(() => undefined)
  return promise
}

export const createVmWorkerClient = (options: VmSessionOptions, hooks: VmWorkerClientHooks = {}): VmWorkerClient => {
  const worker = new Worker(workerEntryUrl(), {
    workerData: options,
    stdout: true,
    stderr: true,
    execArgv: [],
  })
  worker.stdout.resume()
  worker.stderr.resume()

  const waiting = new Map<number, Waiting>()
  let nextId = 0

  const failAll = (cause: Error): void => {
    for (const entry of waiting.values()) {
      entry.reject(cause)
    }
    waiting.clear()
    hooks.onExit?.()
  }

  worker.on('message', (message: VmWorkerResponse) => {
    const entry = waiting.get(message.id)
    if (entry !== undefined) {
      waiting.delete(message.id)
      entry.resolve(message.response)
    }
  })
  worker.on('error', (cause: Error) => {
    failAll(cause)
  })
  worker.on('exit', (code: number) => {
    failAll(new Error(`the vm harness worker exited unexpectedly with code ${code}`))
  })

  const run = (request: VmRunRequest): Promise<VmRunResponse> => {
    const id = nextId
    nextId += 1
    const answer = Effect.runPromise(
      Effect.callback<VmRunResponse, Error>((resume) => {
        waiting.set(id, {
          resolve: (response) => resume(Effect.succeed(response)),
          reject: (cause) => resume(Effect.fail(cause)),
        })
        worker.postMessage({ id, request })
      }),
    )
    return keepRejectionObserved(answer)
  }

  const terminate = (): Promise<void> => {
    waiting.clear()
    return worker.terminate().then(() => undefined)
  }

  return { run, terminate }
}
