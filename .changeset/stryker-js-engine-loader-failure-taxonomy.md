---
"@systemfsoftware/stryker-js-engine": minor
---

the plugin loader now reports what each configured plugin resolved to — loaded,
absent, undescribed, or failed — together with the contribution kind and name it
declared, and reports shadowing by winning and losing module name for both name
collisions and framework extension claims (the first module in plugin order wins
an extension); a framework contribution is refused at load when a declared format
hook is not usable or when its declared `contractVersion` is outside the range
the engine supports, and a load failure now carries a typed reason that decides
the process exit class — a missing peer, an unsupported peer version, or an
invalid contribution is a configuration error (exit 2), while a module that
crashes on load is an internal error (exit 4) that the prepare stage preserves
instead of collapsing to its own class
