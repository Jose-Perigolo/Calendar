# Reference

## Options

Validated against plugin `defaults` at registration (Seneca/gubu).

| Option | Default | Description |
| ------ | ------- | ----------- |
| `debug` | `false` | Extra debug logging (e.g. tick errors). |
| `canon` | `{ zone: undefined, base: 'sys', name: 'calendar' }` | Entity canon for persisted events. |
| `now` | `() => Date.now()` | Clock injection for due/notify/ack/snooze. |
| `remindBefore` | `[]` | Default remind offsets (ms) when `add:event` omits them. |
| `tick.active` | `false` | When true, periodically run `notify:due`. |
| `tick.interval` | `60000` | Tick period in ms. Cleared on `seneca.close`. |
| `notifyCallback` | no-op function | Optional `(data) => any` delivery function (`this` = seneca). |

## Entity: `sys/calendar` (default)

| Field | Type | Notes |
| ----- | ---- | ----- |
| `key` | string | Stable id (`id` = key). Unique; `add:event` rejects duplicates. |
| `kind` | string | e.g. `tls`, `secret`, `token`. |
| `title` | string | Short label. |
| `description` | string | Longer text. |
| `due` | number | Due instant (Unix ms). |
| `remindBefore` | number[] | Offsets before `due` (ms), largest first when stored. |
| `recurrence` | string | `none` \| `daily` \| `weekly` \| `monthly` \| `yearly` \| `interval-ms`. |
| `intervalMs` | number | Step for `interval-ms` recurrence. |
| `severity` | string | `info` \| `warn` \| `critical`. |
| `status` | string | `active` \| `acknowledged` \| `snoozed` \| `done`. |
| `snoozeUntil` | number \| null | Wake time when snoozed. |
| `lastNotified` | number \| null | Last `notify:due` emission time. |
| `notifiedStages` | number[] | Reminder stages already emitted this cycle (includes `0` for due). |
| `assignee` | string \| null | Optional owner. |
| `tags` | string[] | Labels. |
| `meta` | object | Free-form metadata. |

## Action patterns

All under `sys:calendar`.

### `add:event`

Create an event. Fails with `why: 'key-exists'` if the key exists, unless `existing:true` (returns the existing row, does not overwrite).

Parameters: `key`, `due` (required); `kind`, `title`, `description`, `remindBefore`, `recurrence`, `severity`, `assignee`, `tags`, `meta`, `intervalMs`, `existing`.

Returns: `{ ok, event?, why? }`.

### `get:event`

Parameters: `key`.

Returns: `{ ok, event }`.

### `list:event`

Parameters: `q` (entity list query, default `{}`).

Returns: `{ ok, list }`.

### `update:event`

Parameters: `key` plus any updatable fields.

Returns: `{ ok, event?, why? }`.

### `remove:event`

Parameters: `key`.

Returns: `{ ok, event?, why? }`.

### `due:events`

Active events (or snoozed with `snoozeUntil` elapsed) whose `now >= due - max(remindBefore)`.

Parameters: optional `now`.

Returns: `{ ok, now, list }`.

### `ack:event`

Acknowledge. Recurring (`recurrence !== 'none'`): advance `due` with calendar-correct month/year (or fixed interval), keep `active`, clear `notifiedStages`. Non-recurring: set `status` to `done` (unless `done:false` → `acknowledged`).

Parameters: `key`; optional `now`, `done`.

Returns: `{ ok, now, event?, why? }`.

### `snooze:event`

Set `status: 'snoozed'`, `snoozeUntil: until`, clear notify stages.

Parameters: `key`, `until`; optional `now`.

Returns: `{ ok, now, event?, why? }`.

### `notify:due`

For each due event, compute crossed reminder stages; emit only stages not in `notifiedStages`. Delivery via `notifyCallback` and/or `sys:calendar,hook:notify`. Persist updated `notifiedStages` / `lastNotified`.

Parameters: optional `now`.

Returns: `{ ok, now, notified }` where each item is `{ key, stages, event }`.

### `hook:notify` (optional, app-registered)

Not registered by the plugin (so it is not re-pinned over your handler at init).
Add it yourself to receive deliveries from `notify:due`:

```js
seneca.message('sys:calendar,hook:notify', async function (msg) {
  // msg.event, msg.stages, msg.now
  return { ok: true }
})
```

Parameters: `event`, `stages`, `now`.
