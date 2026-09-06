# Dynamic test cleanup

`withTestCleanup(callback)` gives framework-neutral tests a browser-safe way to
register teardown immediately after acquiring a resource. The callback receives
a registrar that accepts synchronous or asynchronous cleanup functions.

```js
import {withTestCleanup} from "@velocious/testing"

await withTestCleanup(async (after) => {
  const connection = await connect()
  after(() => connection.close())

  const subscription = await connection.subscribe()
  after(() => subscription.unsubscribe())

  await verifySubscription(subscription)
})
```

Cleanups run in FIFO registration order after the callback settles. Every
registered cleanup runs even when the callback or an earlier cleanup fails.
If exactly one operation throws or rejects, that value is rethrown unchanged,
including non-`Error` JavaScript values. When multiple operations fail,
`withTestCleanup()` throws an `AggregateError` whose `errors` preserve execution
order: the primary callback failure first, followed by cleanup failures in FIFO
order.

The root export has no Node built-in dependency and is safe for browser and
Metro bundles.
