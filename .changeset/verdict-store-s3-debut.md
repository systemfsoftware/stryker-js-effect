---
"@systemfsoftware/stryker-js-verdict-store-s3": minor
---

First release. An S3 bucket as the Stryker verdict store, so parallel shards, later runs and other pull requests reuse each other's mutation verdicts. Each verdict is one object under `<prefix>/v1/<mutantId>/`, named by its content-addressed key and written with a plain `PutObject`; S3 never shows a partly written object, and the last writer of a key wins.

Credentials come only from the AWS SDK default chain, never from the Stryker configuration. A custom `endpoint` must be https unless its host is loopback or `host.microsandbox.internal`. Opening the store asks the bucket for its head, so a missing bucket or an untrusted endpoint stops the run before any mutant is tested.
