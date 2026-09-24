import { Schema as S } from 'effect'
import * as Result from 'effect/Result'

import { createVmSession, type VmSession } from './session.js'
import type { VmRunRequest, VmRunResponse, VmSessionOptions, VmWorkerRequest } from './vm-protocol.schema.js'
import { VmSessionOptionsSchema } from './vm-protocol.schema.js'

type AnyDecoded<A = unknown> = A

const workerThreads = globalThis.process.getBuiltinModule('node:worker_threads')

const { parentPort } = workerThreads
const workerDataValue: AnyDecoded = workerThreads.workerData

const port = parentPort

if (port === null) {
  throw new Error('the vm harness worker entry answers a parent port; start it as a worker thread')
}

const decoded = S.decodeUnknownResult(VmSessionOptionsSchema)(workerDataValue)
if (Result.isFailure(decoded)) {
  throw new Error('the vm harness worker received unusable session options', { cause: decoded.failure })
}
const options: VmSessionOptions = decoded.success

let session: VmSession | undefined
let bootFailure: Error | undefined

const bootFailureOf = (failure: Error | undefined): Error => failure ?? new Error('the vm harness worker never booted')

const runRequest = (request: VmRunRequest): Promise<VmRunResponse> =>
  session === undefined ? Promise.reject(bootFailureOf(bootFailure)) : session.run(request)

const answer = (message: VmWorkerRequest): Promise<void> =>
  runRequest(message.request).then(
    (response) => port.postMessage({ id: message.id, response }),
    (cause: Error) =>
      port.postMessage({
        id: message.id,
        response: { status: 'error', errorMessage: cause.message } satisfies VmRunResponse,
      }),
  )

const buffered: VmWorkerRequest[] = []
const buffer = (message: VmWorkerRequest): void => {
  buffered.push(message)
}
port.on('message', buffer)

try {
  session = await createVmSession(options)
} catch (cause: unknown) {
  bootFailure = cause instanceof Error ? cause : new Error('the vm harness worker never booted', { cause })
} finally {
  port.off('message', buffer)
}

for (const queued of buffered.splice(0)) {
  await answer(queued)
}
port.on('message', (message: VmWorkerRequest) => {
  void answer(message)
})
