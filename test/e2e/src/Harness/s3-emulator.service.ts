import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { Context, Effect, Layer } from 'effect'
import { createEmulator } from 'emulate'

const LISTEN_ON_EVERY_INTERFACE = '0.0.0.0'
const GUEST_HOST = 'host.microsandbox.internal'
const REGION = 'us-east-1'
const CREDENTIALS = { accessKeyId: 'emulate', secretAccessKey: 'emulate' } as const

export interface S3EmulatorShape {
  readonly guestEndpoint: string
  readonly region: string
  readonly guestEnvironment: Readonly<Record<string, string>>
  readonly emptyBucket: (bucket: string) => Effect.Effect<void>
}

const portOf = (url: string): string => new URL(url).port

export class S3Emulator extends Context.Service<S3Emulator, S3EmulatorShape>()(
  '@systemfsoftware/stryker-e2e/Harness/S3Emulator',
) {
  static readonly layer = Layer.effect(
    S3Emulator,
    Effect.gen(function*() {
      const emulator = yield* Effect.acquireRelease(
        Effect.promise(() => createEmulator({ service: 'aws', port: 0, hostname: LISTEN_ON_EVERY_INTERFACE })),
        (started) => Effect.promise(() => started.close()),
      )
      const port = portOf(emulator.url)
      const client = yield* Effect.acquireRelease(
        Effect.sync(() =>
          new S3Client({
            region: REGION,
            endpoint: `http://127.0.0.1:${port}`,
            forcePathStyle: true,
            credentials: CREDENTIALS,
          })
        ),
        (created) => Effect.sync(() => created.destroy()),
      )
      return {
        guestEndpoint: `http://${GUEST_HOST}:${port}`,
        region: REGION,
        guestEnvironment: {
          AWS_ACCESS_KEY_ID: CREDENTIALS.accessKeyId,
          AWS_SECRET_ACCESS_KEY: CREDENTIALS.secretAccessKey,
          AWS_REGION: REGION,
        },
        emptyBucket: (bucket) =>
          Effect.sync(() => emulator.reset()).pipe(
            Effect.andThen(Effect.promise(() => client.send(new CreateBucketCommand({ Bucket: bucket })))),
            Effect.asVoid,
          ),
      }
    }),
  )
}
