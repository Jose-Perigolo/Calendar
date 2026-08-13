/* Copyright © 2024–2026 Seneca Project Contributors, MIT License. */


export type Recurrence =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'interval-ms'

export type Severity = 'info' | 'warn' | 'critical'
export type Status = 'active' | 'acknowledged' | 'snoozed' | 'done'

export type CalendarEvent = {
  key: string
  kind?: string
  title?: string
  description?: string
  due: number
  remindBefore: number[]
  recurrence: Recurrence
  severity: Severity
  status: Status
  snoozeUntil?: number | null
  lastNotified?: number | null
  notifiedStages: number[]
  assignee?: string | null
  tags?: string[]
  meta?: Record<string, any>
  /** For recurrence === 'interval-ms' */
  intervalMs?: number
}


type CalendarOptionsFull = {
  debug: boolean
  canon: {
    zone: string | undefined
    base: string | undefined
    name: string | undefined
  }
  /** Injectable clock; defaults to Date.now */
  now: () => number
  /** Default remind-before offsets (ms) applied when add:event omits remindBefore */
  remindBefore: number[]
  tick: {
    active: boolean
    interval: number
  }
  /** Optional delivery callback; also see sys:calendar,hook:notify */
  notifyCallback: (data: any) => any
}

export type CalendarOptions = Partial<CalendarOptionsFull>


const MS_DAY = 24 * 60 * 60 * 1000
const MS_WEEK = 7 * MS_DAY

const VALID_RECURRENCE: Recurrence[] = [
  'none',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'interval-ms',
]

const VALID_SEVERITY: Severity[] = ['info', 'warn', 'critical']
const VALID_STATUS: Status[] = ['active', 'acknowledged', 'snoozed', 'done']


/** Add calendar months (UTC) without day-of-month overflow (e.g. Jan 31 + 1m → Feb 28/29). */
function addMonths(ms: number, months: number): number {
  const d = new Date(ms)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.getTime()
}


function addYears(ms: number, years: number): number {
  return addMonths(ms, years * 12)
}


function nextDue(
  due: number,
  recurrence: Recurrence,
  intervalMs?: number,
): number {
  switch (recurrence) {
    case 'daily':
      return due + MS_DAY
    case 'weekly':
      return due + MS_WEEK
    case 'monthly':
      return addMonths(due, 1)
    case 'yearly':
      return addYears(due, 1)
    case 'interval-ms': {
      const step = null != intervalMs && intervalMs > 0 ? intervalMs : MS_DAY
      return due + step
    }
    case 'none':
    default:
      return due
  }
}


/** Stages (remindBefore values) that have been crossed at `now` relative to `due`. */
function crossedStages(
  due: number,
  remindBefore: number[],
  now: number,
): number[] {
  const stages = uniqueSortedDesc(remindBefore)
  const out: number[] = []
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]
    if (now >= due - stage) {
      out.push(stage)
    }
  }
  // Also treat "at/after due" as stage 0 when due itself is reached
  if (now >= due && out.indexOf(0) < 0) {
    out.push(0)
  }
  return out
}


function uniqueSortedDesc(values: number[]): number[] {
  const seen: Record<string, boolean> = {}
  const out: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i])
    if (!isFinite(v) || v < 0) continue
    const k = String(v)
    if (seen[k]) continue
    seen[k] = true
    out.push(v)
  }
  out.sort((a, b) => b - a)
  return out
}


function stagesNotYetNotified(
  crossed: number[],
  notifiedStages: number[],
): number[] {
  const notified: Record<string, boolean> = {}
  for (let i = 0; i < notifiedStages.length; i++) {
    notified[String(notifiedStages[i])] = true
  }
  const fresh: number[] = []
  for (let i = 0; i < crossed.length; i++) {
    if (!notified[String(crossed[i])]) {
      fresh.push(crossed[i])
    }
  }
  return fresh
}


function isDueWindow(
  entry: any,
  now: number,
): boolean {
  // Only active events; snoozed count once snoozeUntil has passed.
  if ('active' === entry.status) {
    // ok
  } else if (
    'snoozed' === entry.status &&
    null != entry.snoozeUntil &&
    now >= entry.snoozeUntil
  ) {
    // woken by clock — treat as due-eligible
  } else {
    return false
  }

  const remindBefore: number[] = Array.isArray(entry.remindBefore)
    ? entry.remindBefore
    : []
  const maxRemind = remindBefore.reduce(
    (m: number, v: number) => (v > m ? v : m),
    0,
  )
  return now >= entry.due - maxRemind
}


function canonString(canon: CalendarOptionsFull['canon']): string {
  return (
    ('string' === typeof canon.zone ? canon.zone : '-') +
    '/' +
    ('string' === typeof canon.base ? canon.base : '-') +
    '/' +
    ('string' === typeof canon.name ? canon.name : '-')
  )
}


function plainEvent(entry: any): any {
  return null == entry ? undefined : entry.data$(false)
}


function Calendar(this: any, options: CalendarOptionsFull) {
  const seneca: any = this

  const { Default } = seneca.valid

  const canon = canonString(options.canon)
  const getNow = typeof options.now === 'function' ? options.now : () => Date.now()

  let tickTimer: ReturnType<typeof setInterval> | null = null

  seneca
    .fix('sys:calendar')
    .message('add:event', {
      key: String,
      due: Number,
      existing: Default(false),
    }, msgAddEvent)
    .message('get:event', { key: String }, msgGetEvent)
    .message('list:event', { q: Default({}) }, msgListEvent)
    .message('update:event', { key: String }, msgUpdateEvent)
    .message('remove:event', { key: String }, msgRemoveEvent)
    .message('due:events', {}, msgDueEvents)
    .message('ack:event', { key: String }, msgAckEvent)
    .message('snooze:event', { key: String, until: Number }, msgSnoozeEvent)
    .message('notify:due', {}, msgNotifyDue)

  // Note: do not register a default sys:calendar,hook:notify action.
  // Plugin init would re-pin it above handlers added between use() and ready().
  // Apps register the hook themselves; notify:due calls it when present.


  seneca.add('init:Calendar', function (this: any, _msg: any, reply: any) {
    if (options.tick && options.tick.active) {
      const interval =
        options.tick.interval > 0 ? options.tick.interval : 60 * 1000
      tickTimer = setInterval(() => {
        seneca.act('sys:calendar,notify:due', function (err: any) {
          if (err && options.debug) {
            seneca.log.debug('calendar-tick-error', err)
          }
        })
      }, interval)
      if (typeof (tickTimer as any).unref === 'function') {
        ;(tickTimer as any).unref()
      }
    }
    reply()
  })

  seneca.add('role:seneca,cmd:close', function (this: any, msg: any, reply: any) {
    if (null != tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
    this.prior(msg, reply)
  })


  async function msgAddEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key
    const existing = true === msg.existing

    let entry = await seneca.entity(canon).load$(key)

    if (null != entry) {
      if (existing) {
        return {
          ok: true,
          why: 'existing',
          event: plainEvent(entry),
        }
      }
      return {
        ok: false,
        why: 'key-exists',
        event: plainEvent(entry),
      }
    }

    const remindBefore = uniqueSortedDesc(
      Array.isArray(msg.remindBefore) ? msg.remindBefore : options.remindBefore,
    )

    const recurrence: Recurrence =
      VALID_RECURRENCE.indexOf(msg.recurrence) >= 0 ? msg.recurrence : 'none'
    const severity: Severity =
      VALID_SEVERITY.indexOf(msg.severity) >= 0 ? msg.severity : 'info'

    const data: any = {
      id$: key,
      key,
      kind: null != msg.kind ? String(msg.kind) : 'maintenance',
      title: null != msg.title ? String(msg.title) : key,
      description: null != msg.description ? String(msg.description) : '',
      due: Number(msg.due),
      remindBefore,
      recurrence,
      severity,
      status: 'active' as Status,
      snoozeUntil: null,
      lastNotified: null,
      notifiedStages: [],
      assignee: null != msg.assignee ? msg.assignee : null,
      tags: Array.isArray(msg.tags) ? msg.tags.slice() : [],
      meta: msg.meta && 'object' === typeof msg.meta ? Object.assign({}, msg.meta) : {},
    }

    if ('interval-ms' === recurrence) {
      data.intervalMs =
        null != msg.intervalMs
          ? Number(msg.intervalMs)
          : null != msg.meta && null != msg.meta.intervalMs
            ? Number(msg.meta.intervalMs)
            : MS_DAY
    }

    entry = await seneca.entity(canon).data$(data).save$()

    return {
      ok: true,
      event: plainEvent(entry),
    }
  }


  async function msgGetEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key
    const entry = await seneca.entity(canon).load$(key)

    return {
      ok: null != entry,
      event: plainEvent(entry),
    }
  }


  async function msgListEvent(this: any, msg: any) {
    const seneca = this
    const q = msg.q || {}
    let list = await seneca.entity(canon).list$(q)
    list = list.map((entry: any) => entry.data$(false))

    return {
      ok: true,
      list,
    }
  }


  async function msgUpdateEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key

    let entry = await seneca.entity(canon).load$(key)
    if (null == entry) {
      return {
        ok: false,
        why: 'key-not-found',
      }
    }

    const fields = [
      'kind',
      'title',
      'description',
      'due',
      'severity',
      'status',
      'snoozeUntil',
      'assignee',
      'tags',
      'meta',
      'intervalMs',
      'lastNotified',
      'notifiedStages',
    ]

    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]
      if (undefined !== msg[f]) {
        entry[f] = msg[f]
      }
    }

    if (undefined !== msg.remindBefore) {
      entry.remindBefore = uniqueSortedDesc(
        Array.isArray(msg.remindBefore) ? msg.remindBefore : [],
      )
    }

    if (undefined !== msg.recurrence) {
      if (VALID_RECURRENCE.indexOf(msg.recurrence) < 0) {
        return { ok: false, why: 'invalid-recurrence' }
      }
      entry.recurrence = msg.recurrence
    }

    if (undefined !== msg.severity && VALID_SEVERITY.indexOf(msg.severity) < 0) {
      return { ok: false, why: 'invalid-severity' }
    }

    if (undefined !== msg.status && VALID_STATUS.indexOf(msg.status) < 0) {
      return { ok: false, why: 'invalid-status' }
    }

    entry = await entry.save$()

    return {
      ok: true,
      event: plainEvent(entry),
    }
  }


  async function msgRemoveEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key
    const entry = await seneca.entity(canon).load$(key)

    if (null == entry) {
      return {
        ok: false,
        why: 'key-not-found',
      }
    }

    await seneca.entity(canon).remove$(key)

    return {
      ok: true,
      event: plainEvent(entry),
    }
  }


  async function msgDueEvents(this: any, msg: any) {
    const seneca = this
    const now = null != msg.now ? Number(msg.now) : getNow()

    let list = await seneca.entity(canon).list$({})
    const due = list
      .filter((entry: any) => isDueWindow(entry, now))
      .map((entry: any) => entry.data$(false))

    return {
      ok: true,
      now,
      list: due,
    }
  }


  async function msgAckEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key
    const now = null != msg.now ? Number(msg.now) : getNow()

    let entry = await seneca.entity(canon).load$(key)
    if (null == entry) {
      return {
        ok: false,
        why: 'key-not-found',
      }
    }

    const recurrence: Recurrence = entry.recurrence || 'none'

    // Reset notify stage tracking for the next cycle
    entry.notifiedStages = []
    entry.lastNotified = null
    entry.snoozeUntil = null

    if ('none' !== recurrence) {
      entry.due = nextDue(entry.due, recurrence, entry.intervalMs)
      entry.status = 'active'
    } else {
      entry.status = true === msg.done || undefined === msg.done ? 'done' : 'acknowledged'
      if ('acknowledged' === entry.status) {
        // still acknowledged once; no recurrence
      }
    }

    entry = await entry.save$()

    return {
      ok: true,
      now,
      event: plainEvent(entry),
    }
  }


  async function msgSnoozeEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key
    const until = Number(msg.until)
    const now = null != msg.now ? Number(msg.now) : getNow()

    let entry = await seneca.entity(canon).load$(key)
    if (null == entry) {
      return {
        ok: false,
        why: 'key-not-found',
      }
    }

    if (!isFinite(until) || until <= now) {
      return {
        ok: false,
        why: 'invalid-until',
      }
    }

    entry.status = 'snoozed'
    entry.snoozeUntil = until
    // Reset stages so the next threshold after wake notifies cleanly
    entry.notifiedStages = []
    entry.lastNotified = null

    entry = await entry.save$()

    return {
      ok: true,
      now,
      event: plainEvent(entry),
    }
  }


  async function msgNotifyDue(this: any, msg: any) {
    const seneca = this
    const now = null != msg.now ? Number(msg.now) : getNow()

    let list = await seneca.entity(canon).list$({})
    const emissions: any[] = []

    for (let i = 0; i < list.length; i++) {
      let entry = list[i]

      // Wake snoozed events whose snooze has expired
      if ('snoozed' === entry.status && null != entry.snoozeUntil && now >= entry.snoozeUntil) {
        entry.status = 'active'
        entry.snoozeUntil = null
      }

      if (!isDueWindow(entry, now)) {
        continue
      }

      const remindBefore: number[] = Array.isArray(entry.remindBefore)
        ? entry.remindBefore
        : []
      const notifiedStages: number[] = Array.isArray(entry.notifiedStages)
        ? entry.notifiedStages
        : []

      const crossed = crossedStages(entry.due, remindBefore, now)
      const fresh = stagesNotYetNotified(crossed, notifiedStages)

      if (0 === fresh.length) {
        continue
      }

      const payload = {
        event: entry.data$(false),
        stages: fresh,
        now,
      }

      // Pluggable delivery: option callback and/or registered hook
      if (typeof options.notifyCallback === 'function') {
        await options.notifyCallback.call(seneca, payload)
      }

      if (seneca.find('sys:calendar,hook:notify')) {
        await seneca.post('sys:calendar,hook:notify', payload)
      }

      entry.notifiedStages = notifiedStages.concat(fresh)
      entry.lastNotified = now
      entry = await entry.save$()

      emissions.push({
        key: entry.key,
        stages: fresh,
        event: plainEvent(entry),
      })
    }

    return {
      ok: true,
      now,
      notified: emissions,
    }
  }
}


// Default options — Seneca validates plugin options against this shape (gubu).
const defaults: CalendarOptionsFull = {
  debug: false,

  canon: {
    zone: undefined,
    base: 'sys',
    name: 'calendar',
  },

  now: () => Date.now(),

  // empty = only the due instant (stage 0) counts unless caller sets remindBefore
  remindBefore: [],

  tick: {
    active: false,
    interval: 60 * 1000,
  },

  // no-op; override to deliver (null breaks Seneca/gubu option shape walk)
  notifyCallback: function (_data: any) {},
}


Object.assign(Calendar, { defaults })

// Prevent name mangling (init:Calendar, close cleanup)
Object.defineProperty(Calendar, 'name', { value: 'Calendar' })

// Attach helpers for CommonJS consumers (module.exports replaces named exports)
;(Calendar as any).nextDue = nextDue
;(Calendar as any).crossedStages = crossedStages

export { nextDue, crossedStages }
export default Calendar

if ('undefined' !== typeof module) {
  module.exports = Calendar
}
