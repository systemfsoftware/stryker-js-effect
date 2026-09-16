---
"@systemfsoftware/stryker-js-engine": major
---

the plugin loader now reports what each configured plugin resolved to — loaded,
absent, undescribed, or failed — with the contribution kind and name it declared,
and reports shadowing by winning and losing module name for both name collisions
and framework extension claims (the first module in plugin order wins an
extension). A load failure no longer carries a bare `cause`: it carries a typed
`reason` — a missing peer, an unsupported peer version, an invalid contribution,
or a module that crashed on load — and that reason decides the process exit class:
a missing peer, an unsupported peer version, or an invalid contribution exits as a
configuration error (2), a crashing module stays an internal error (4), a class
the prepare stage now preserves. A framework contribution is refused at load when
a declared format hook is not usable or its `contractVersion` is out of range.
