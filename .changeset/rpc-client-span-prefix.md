---
"@systemfsoftware/stryker-js": patch
---

Each call the CLI makes to a plugin worker is traced as `RpcClient.<method>` again, the name the span taxonomy declares. effect 4.0.0 used that prefix by default; later effect releases name the span after the method alone, so `RpcClient.check`, `RpcClient.mutantRun` and their siblings had stopped appearing.
