## 8.0.2

### Patch Changes

- Fixed a rare hang where a run stopped making progress while a test runner or checker worker waited for a message that had already arrived. The message now always wakes the worker waiting for it.
