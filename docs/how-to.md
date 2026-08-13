# How-to guides

## Seed events idempotently

`add:event` rejects duplicate keys. For deploy-time seeding:

```js
await seneca.post('sys:calendar,add:event', {
  key: 'client-secret-foo',
  due: secretExpiresAt,
  existing: true, // ok:true, why:'existing' if already present
})
```

To change an existing event, use `update:event`.

## Inject a clock for tests

```js
let now = 1_700_000_000_000
seneca.use(Calendar, { now: () => now })
// or per call:
await seneca.post('sys:calendar,due:events', { now })
```

## Wire delivery without hardcoding a channel

**Option A — callback**

```js
.use(Calendar, {
  notifyCallback: async function (data) {
    await myQueue.push(data.event)
  },
})
```

**Option B — hook message**

Register `sys:calendar,hook:notify` yourself (the plugin does not ship a default
action, so your handler is not overwritten at init):

```js
seneca.message('sys:calendar,hook:notify', async function (msg) {
  await sendSlack(msg.event)
  return { ok: true }
})
```

Both can be used together. `notify:due` only emits **newly crossed** stages (see `notifiedStages` on the entity).

## Avoid reminder spam

With `remindBefore: [30d, 7d, 1d]`, call `notify:due` on a poll/tick. The first poll inside the 30-day window emits once; later polls in the same window emit nothing until the 7-day stage is crossed.

`ack:event` and `snooze:event` clear `notifiedStages` so the next cycle can notify again.

## Enable an optional tick

Off by default. When enabled, the plugin posts `notify:due` on an interval and **clears the timer on `seneca.close`**:

```js
.use(Calendar, {
  tick: { active: true, interval: 60_000 },
})
```

## Change recurrence after create

```js
await seneca.post('sys:calendar,update:event', {
  key: 'tls-api',
  recurrence: 'monthly',
})
```

`monthly` / `yearly` use calendar arithmetic (Jan 31 → Feb 28/29). `interval-ms` uses a fixed millisecond step (`intervalMs` on the event).
