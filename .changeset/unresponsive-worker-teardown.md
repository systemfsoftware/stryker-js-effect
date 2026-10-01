---
"@systemfsoftware/stryker-js": patch
---

A test runner, checker, or reporter process that stops responding no longer hangs the mutation run forever. When such a process does not exit within 5 seconds of being asked to stop, Stryker force-kills it, so the run ends with an error instead of waiting until something kills it from outside.
