import { type MessagePort, parentPort } from 'node:worker_threads'

import type { VmVitestConfig } from '../../core/vitest-config.schema.js'
import { createVitestHost, type VmVitestHost } from './host-core.js'

export interface VmHostInitMessage {
  readonly sandboxWorkingDirectory: string
  readonly configFile?: string
  readonly port: MessagePort
  readonly sharedBuffer: SharedArrayBuffer
}

export type VmHostRequest =
  | { readonly seq: number; readonly kind: 'transform'; readonly code: string; readonly moduleId: string }
  | { readonly seq: number; readonly kind: 'resolveId'; readonly specifier: string; readonly importer: string }
  | { readonly seq: number; readonly kind: 'transformRequest'; readonly moduleId: string }
  | { readonly seq: number; readonly kind: 'snapshotPath'; readonly testPath: string }
  | { readonly seq: number; readonly kind: 'listTestFiles' }
  | { readonly seq: number; readonly kind: 'projectFiles' }

export type VmHostReply =
  | { readonly seq: number; readonly kind: 'transform'; readonly code: string | undefined }
  | { readonly seq: number; readonly kind: 'resolveId'; readonly resolved: string | undefined }
  | { readonly seq: number; readonly kind: 'snapshotPath'; readonly path: string }
  | { readonly seq: number; readonly kind: 'files'; readonly files: ReadonlyArray<string> }
  | {
    readonly seq: number
    readonly kind: 'projects'
    readonly projects: ReadonlyArray<{ readonly name: string; readonly files: ReadonlyArray<string> }>
  }
  | { readonly seq: number; readonly kind: 'error'; readonly message: string }

export type VmHostAnnouncement =
  | { readonly kind: 'ready'; readonly config: VmVitestConfig; readonly hasTransformPlugins: boolean }
  | { readonly kind: 'init-failed'; readonly message: string }

interface Rejection {
  readonly message?: string
}

const replyFor = (host: VmVitestHost, request: VmHostRequest): Promise<VmHostReply> => {
  switch (request.kind) {
    case 'transform':
      return host.transform(request.code, request.moduleId).then(
        (result): VmHostReply => ({ seq: request.seq, kind: 'transform', code: result?.code }),
      )
    case 'resolveId':
      return host.resolveId(request.specifier, request.importer).then(
        (resolved): VmHostReply => ({ seq: request.seq, kind: 'resolveId', resolved }),
      )
    case 'transformRequest':
      return host.transformRequest(request.moduleId).then(
        (result): VmHostReply => ({ seq: request.seq, kind: 'transform', code: result?.code }),
      )
    case 'snapshotPath':
      return host.resolveSnapshotPath(request.testPath).then(
        (path): VmHostReply => ({ seq: request.seq, kind: 'snapshotPath', path }),
      )
    case 'listTestFiles':
      return host.listTestFiles().then((files): VmHostReply => ({ seq: request.seq, kind: 'files', files }))
    case 'projectFiles':
      return host.listProjectFiles().then((projects): VmHostReply => ({ seq: request.seq, kind: 'projects', projects }))
  }
}

const serve = (host: VmVitestHost, hostPort: MessagePort, signal: () => void, request: VmHostRequest): void => {
  replyFor(host, request).then(
    (reply) => {
      hostPort.postMessage(reply)
      signal()
    },
    (reason: Rejection) => {
      const failure: VmHostReply = {
        seq: request.seq,
        kind: 'error',
        message: reason.message ?? 'Vitest transform host request failed',
      }
      hostPort.postMessage(failure)
      signal()
    },
  )
}

parentPort?.once('message', (init: VmHostInitMessage) => {
  const flags = new Int32Array(init.sharedBuffer)
  const hostPort: MessagePort = init.port
  const signal = (): void => {
    Atomics.store(flags, 0, 1)
    Atomics.notify(flags, 0)
  }
  createVitestHost({
    sandboxWorkingDirectory: init.sandboxWorkingDirectory,
    configFile: init.configFile,
  }).then(
    (host) => {
      const announcement: VmHostAnnouncement = {
        kind: 'ready',
        config: host.config,
        hasTransformPlugins: host.hasTransformPlugins,
      }
      hostPort.postMessage(announcement)
      signal()
      hostPort.on('message', (request: VmHostRequest) => {
        serve(host, hostPort, signal, request)
      })
      parentPort?.on('close', () => {
        host.close().then(
          () => {
            process.exit(0)
          },
          () => {
            process.exit(1)
          },
        )
      })
    },
    (reason: Rejection) => {
      const announcement: VmHostAnnouncement = {
        kind: 'init-failed',
        message: reason.message ?? 'Vitest transform host failed to start',
      }
      hostPort.postMessage(announcement)
      signal()
    },
  )
})
