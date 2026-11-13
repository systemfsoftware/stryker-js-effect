---
"@systemfsoftware/stryker-js-verdict-store-s3": minor
---

First release. An S3 bucket as the Stryker verdict store, so parallel shards, later runs and other pull requests reuse each other's mutation verdicts. Each verdict is one object under `<prefix>/verdict-key-1+sha256+mutant-id-sha256/<mutantId>/`, named by its content-addressed key and written with a plain `PutObject`. S3 never exposes a partly written object, and when two writers put the same key the last one wins.

Credentials come only from the AWS SDK default chain. A custom `endpoint` must be https unless its host is loopback or `host.microsandbox.internal`. Opening the store asks the bucket for its head, so a missing bucket or an untrusted endpoint stops the run before any mutant is tested. `connectionTimeoutMs` (default 3000) and `requestTimeoutMs` (default 30000) bound every request, so an endpoint that never answers refuses the store instead of hanging the run.
