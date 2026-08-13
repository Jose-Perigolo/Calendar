# @seneca/calendar

> _Seneca Calendar_ is a plugin for [Seneca](http://senecajs.org)

Track time-based maintenance events (client-secret expiry, TLS/cert renewal,
token rotation, and similar) and report which are due. Delivery is pluggable —
the plugin does not hardcode email or UI.

[![npm version](https://img.shields.io/npm/v/@seneca/calendar.svg)](https://npmjs.com/package/@seneca/calendar)
[![build](https://github.com/senecajs/Calendar/actions/workflows/build.yml/badge.svg)](https://github.com/senecajs/Calendar/actions/workflows/build.yml)

| ![Voxgig](https://www.voxgig.com/res/img/vgt01r.png) | This open source module is sponsored and supported by [Voxgig](https://www.voxgig.com). |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |

## Install

```sh
$ npm install @seneca/calendar
```

Requires Node `>=16`, Seneca `>=3`, and `seneca-entity` `>=25`.

## Documentation

| [Tutorial](docs/tutorial.md)       | Learning: add an event, check due, wire a notify hook.                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| [How-to guide](docs/how-to.md)     | Doing: seeding, clock injection, delivery, tick, recurrence.                    |
| [Reference](docs/reference.md)     | Looking up: options, entity fields, every `sys:calendar` message.               |
| [Explanation](docs/explanation.md) | Understanding: due windows vs notify stages, calendar recurrence, pluggable IO. |

## Quick Example

```js
const Seneca = require('seneca')

const MS_DAY = 24 * 60 * 60 * 1000
const due = Date.UTC(2026, 5, 1)

const seneca = Seneca({ legacy: false })
  .use('promisify')
  .use('entity')
  .use('calendar', {
    // Optional: inject a clock (useful in tests)
    // now: () => Date.now(),
  })

seneca.message('sys:calendar,hook:notify', async function (msg) {
  // Pluggable delivery — send Slack/email/UI from here.
  console.log('due', msg.event.key, 'stages', msg.stages)
  return { ok: true }
})

await seneca.ready()

await seneca.post('sys:calendar,add:event', {
  key: 'tls-api',
  kind: 'tls',
  title: 'Renew api.example.com',
  due,
  remindBefore: [30 * MS_DAY, 7 * MS_DAY, MS_DAY],
  severity: 'warn',
  recurrence: 'yearly',
})

// Which events are inside a remind window?
const dueRes = await seneca.post('sys:calendar,due:events', {
  now: due - 7 * MS_DAY,
})
// dueRes.list → [ { key: 'tls-api', ... } ]

// Emit only newly crossed reminder stages (deduped per stage).
await seneca.post('sys:calendar,notify:due', { now: due - 7 * MS_DAY })

// Acknowledge: yearly events roll due by one calendar year; stages reset.
await seneca.post('sys:calendar,ack:event,key:tls-api')
```

## More Examples

Review the [unit tests](test/Calendar.test.ts) and [tutorial](docs/tutorial.md).

## Options

* `debug` : boolean — extra logging (default `false`)
* `canon` : object — entity canon (default `{ base: 'sys', name: 'calendar' }`)
* `now` : function — clock `() => number` (default `Date.now`)
* `remindBefore` : number[] — default remind offsets in ms (default `[]`)
* `tick` : `{ active: boolean, interval: number }` — optional poller, off by default; cleared on close
* `notifyCallback` : function — optional delivery callback (default no-op)

## Action Patterns

* `sys:calendar,add:event` — create (rejects duplicate `key`; `existing:true` for idempotent seed)
* `sys:calendar,get:event` — load by key
* `sys:calendar,list:event` — list by query
* `sys:calendar,update:event` — update fields
* `sys:calendar,remove:event` — remove by key
* `sys:calendar,due:events` — active events inside remind window
* `sys:calendar,ack:event` — acknowledge / roll recurrence; resets notify stages
* `sys:calendar,snooze:event` — snooze until timestamp; resets notify stages
* `sys:calendar,notify:due` — emit newly crossed stages via hook/callback
* `sys:calendar,hook:notify` — app-registered delivery hook (optional; not shipped as a default action)

## Event fields (default entity `sys/calendar`)

`key`, `kind`, `title`, `description`, `due`, `remindBefore`, `recurrence`,
`severity`, `status`, `snoozeUntil`, `lastNotified`, `notifiedStages`,
`assignee`, `tags`, `meta` (plus `intervalMs` when `recurrence` is `interval-ms`).

`notifiedStages` records which remind thresholds already fired so `notify:due`
does not spam on every poll. `ack` / `snooze` clear it for the next cycle.

## Motivation

Maintenance deadlines are operational data. Keeping them as Seneca entities lets
any store back them, any service query what is due, and any channel handle
delivery — without baking a notifier into the plugin.

## Support

If you're using this module and need help, you can:

* Post a GitHub issue
* Tweet to @senecajs
* Ask on the Gitter

## Contributing

The plugin is written in TypeScript under `src/` and published from `dist/` —
run `npm run build` before tests, since tests import behaviour from the built
output and from `src/` via Jest. Documentation lives in `docs/` (Diátaxis).

```sh
npm install
npm i seneca seneca-promisify seneca-entity   # peer deps
npm run build
npm test
```

## Background

Generated from the senecajs/SenecaConfig template; message namespace and entity
model are calendar-specific. Compatible with Node 16+ (no `structuredClone`).
