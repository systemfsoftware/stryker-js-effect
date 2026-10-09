import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadBucketCommand,
  NoSuchKey,
  paginateListObjectsV2,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import {
  EntryAbsent,
  makeVerdictStore,
  VerdictBlobFailed,
  type VerdictBlobs,
  VerdictStore,
  VerdictStoreUnavailable,
} from '@systemfsoftware/stryker-js/verdict-store'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Stream from 'effect/Stream'

export interface S3VerdictStoreOptions {
  readonly bucket: string
  readonly prefix: string
  readonly region?: string | undefined
  /** An S3-compatible endpoint. Must be https unless its host is loopback or the microsandbox host gateway. */
  readonly endpoint?: string | undefined
  readonly forcePathStyle?: boolean | undefined
}

const PLAIN_HTTP_HOSTS: ReadonlyArray<string> = ['localhost', '127.0.0.1', '[::1]', 'host.microsandbox.internal']

const schemesTrustedAt = (hostname: string): ReadonlyArray<string> =>
  PLAIN_HTTP_HOSTS.includes(hostname) ? ['https:', 'http:'] : ['https:']

const acceptsEndpoint = (url: URL): boolean => schemesTrustedAt(url.hostname).includes(url.protocol)

const endpointRefusalOf = (endpoint: string): Option.Option<string> =>
  Option.match(Option.fromNullishOr(URL.parse(endpoint)), {
    onNone: () => Option.some(`the endpoint ${endpoint} is not a URL`),
    onSome: (url) =>
      Option.liftPredicate(
        `the endpoint ${endpoint} must be https unless its host is loopback or host.microsandbox.internal`,
        () => !acceptsEndpoint(url),
      ),
  })

const reasonOf = <A = unknown>(cause: A): string =>
  Predicate.isError(cause) ? `${cause.name}: ${cause.message}` : 'the request failed without an error'

const storeNameOf = (options: S3VerdictStoreOptions): string => `s3://${options.bucket}/${options.prefix}`

const keyPrefixOf = (prefix: string): string => prefix.replace(/\/+$/u, '')

const keyOf = (prefix: string, name: string): string => Arr.join(Arr.filter([prefix, name], (part) => part !== ''), '/')

const failedAt = (name: string) => <A = unknown>(cause: A): VerdictBlobFailed =>
  VerdictBlobFailed.make({ name, reason: reasonOf(cause) })

const absentOrFailedAt = (name: string) => <A = unknown>(cause: A): EntryAbsent | VerdictBlobFailed =>
  cause instanceof NoSuchKey ? EntryAbsent.make({}) : failedAt(name)(cause)

const textOf = (object: GetObjectCommandOutput): Promise<string> =>
  Option.match(Option.fromNullishOr(object.Body), {
    onNone: () => Promise.resolve(''),
    onSome: (body) => body.transformToString(),
  })

const childNameOf = (directoryKey: string) => (key: string): Option.Option<string> =>
  Option.liftPredicate(key.slice(directoryKey.length), (rest) => rest !== '' && !rest.includes('/'))

const s3BlobsOf = (client: S3Client, bucket: string, prefix: string): VerdictBlobs => ({
  read: (name) =>
    Effect.tryPromise({
      try: (signal) =>
        client.send(new GetObjectCommand({ Bucket: bucket, Key: keyOf(prefix, name) }), { abortSignal: signal })
          .then(textOf),
      catch: absentOrFailedAt(name),
    }).pipe(Effect.asSome, Effect.catchTag('EntryAbsent', () => Effect.succeedNone)),
  write: (name, text) =>
    Effect.tryPromise({
      try: (signal) =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: keyOf(prefix, name),
            Body: text,
            ContentType: 'application/json',
          }),
          { abortSignal: signal },
        ),
      catch: failedAt(name),
    }).pipe(Effect.asVoid),
  list: (directory) => {
    const directoryKey = `${keyOf(prefix, directory)}/`
    return Stream.fromAsyncIterable(
      paginateListObjectsV2({ client }, { Bucket: bucket, Prefix: directoryKey }),
      failedAt(directory),
    ).pipe(
      Stream.flatMap((page) => Stream.fromIterable(page.Contents ?? [])),
      Stream.runCollect,
      Effect.map(
        Arr.flatMap((object) =>
          Option.toArray(Option.flatMap(Option.fromNullishOr(object.Key), childNameOf(directoryKey)))
        ),
      ),
    )
  },
})

const clientOf = (options: S3VerdictStoreOptions): S3Client =>
  new S3Client({
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle,
  })

const refuseEndpoint = (options: S3VerdictStoreOptions): Effect.Effect<void, VerdictStoreUnavailable> =>
  Option.match(Option.flatMap(Option.fromNullishOr(options.endpoint), endpointRefusalOf), {
    onNone: () => Effect.void,
    onSome: (reason) => Effect.fail(VerdictStoreUnavailable.make({ store: storeNameOf(options), reason })),
  })

const probeBucket = (client: S3Client, options: S3VerdictStoreOptions): Effect.Effect<void, VerdictStoreUnavailable> =>
  Effect.tryPromise({
    try: (signal) => client.send(new HeadBucketCommand({ Bucket: options.bucket }), { abortSignal: signal }),
    catch: (cause) =>
      VerdictStoreUnavailable.make({
        store: storeNameOf(options),
        reason: `the bucket ${options.bucket} cannot be reached (${reasonOf(cause)})`,
      }),
  }).pipe(Effect.asVoid)

export const layer = (options: S3VerdictStoreOptions): Layer.Layer<VerdictStore, VerdictStoreUnavailable> =>
  Layer.effect(
    VerdictStore,
    Effect.gen(function*() {
      yield* refuseEndpoint(options)
      const client = yield* Effect.acquireRelease(Effect.sync(() => clientOf(options)), (client) =>
        Effect.sync(() => {
          client.destroy()
        }))
      yield* probeBucket(client, options)
      return makeVerdictStore(s3BlobsOf(client, options.bucket, keyPrefixOf(options.prefix)))
    }),
  )
