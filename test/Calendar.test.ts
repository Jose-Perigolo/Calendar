/* Copyright © 2024–2026 Seneca Project Contributors, MIT License. */

import Seneca from 'seneca'

import CalendarDoc from '../src/CalendarDoc'
import Calendar from '../src/Calendar'

const nextDue = (Calendar as any).nextDue as typeof import('../src/Calendar').nextDue
const crossedStages = (Calendar as any).crossedStages as typeof import('../src/Calendar').crossedStages

const MS_DAY = 24 * 60 * 60 * 1000
const MS_HOUR = 60 * 60 * 1000


describe('Calendar', () => {
  test('load-plugin', async () => {
    expect(CalendarDoc).toBeDefined()
    const seneca = Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Calendar)
    await seneca.ready()
  })


  test('add-get-list-update-remove', async () => {
    const seneca = makeSeneca()

    const due = Date.UTC(2026, 5, 1)
    const add0 = await seneca.post('sys:calendar,add:event', {
      key: 'tls-api',
      kind: 'tls',
      title: 'API cert renewal',
      description: 'Renew api.example.com',
      due,
      remindBefore: [7 * MS_DAY, MS_DAY],
      severity: 'warn',
      tags: ['infra'],
      meta: { host: 'api.example.com' },
    })
    expect(add0).toMatchObject({
      ok: true,
      event: {
        key: 'tls-api',
        kind: 'tls',
        title: 'API cert renewal',
        due,
        status: 'active',
        notifiedStages: [],
        recurrence: 'none',
      },
    })

    const addDup = await seneca.post('sys:calendar,add:event', {
      key: 'tls-api',
      due: due + 1,
    })
    expect(addDup).toMatchObject({ ok: false, why: 'key-exists' })

    const addExisting = await seneca.post('sys:calendar,add:event', {
      key: 'tls-api',
      due: due + 1,
      existing: true,
    })
    expect(addExisting).toMatchObject({
      ok: true,
      why: 'existing',
      event: { key: 'tls-api', due },
    })

    const get0 = await seneca.post('sys:calendar,get:event,key:tls-api')
    expect(get0).toMatchObject({ ok: true, event: { key: 'tls-api' } })

    const getMissing = await seneca.post('sys:calendar,get:event,key:nope')
    expect(getMissing).toMatchObject({ ok: false, event: undefined })

    const list0 = await seneca.post('sys:calendar,list:event')
    expect(list0.ok).toBe(true)
    expect(list0.list).toHaveLength(1)

    const upd0 = await seneca.post('sys:calendar,update:event', {
      key: 'tls-api',
      title: 'API cert renewal (prod)',
      severity: 'critical',
    })
    expect(upd0).toMatchObject({
      ok: true,
      event: { title: 'API cert renewal (prod)', severity: 'critical' },
    })

    const updMissing = await seneca.post('sys:calendar,update:event', {
      key: 'missing',
      title: 'x',
    })
    expect(updMissing).toMatchObject({ ok: false, why: 'key-not-found' })

    const rem0 = await seneca.post('sys:calendar,remove:event,key:tls-api')
    expect(rem0).toMatchObject({ ok: true, event: { key: 'tls-api' } })

    const rem1 = await seneca.post('sys:calendar,remove:event,key:tls-api')
    expect(rem1).toMatchObject({ ok: false, why: 'key-not-found' })

    const list1 = await seneca.post('sys:calendar,list:event')
    expect(list1.list).toHaveLength(0)
  })


  test('due-events-with-injected-now', async () => {
    const due = Date.UTC(2026, 0, 15)
    let now = due - 10 * MS_DAY
    const seneca = makeSeneca({ now: () => now })

    await seneca.post('sys:calendar,add:event', {
      key: 'secret-a',
      due,
      remindBefore: [7 * MS_DAY, MS_DAY],
    })

    // Outside window
    let dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes).toMatchObject({ ok: true, list: [] })

    // Enter 7d window
    now = due - 7 * MS_DAY
    dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes.list).toHaveLength(1)
    expect(dueRes.list[0].key).toBe('secret-a')

    // Explicit now on message overrides option clock
    dueRes = await seneca.post('sys:calendar,due:events', {
      now: due - 10 * MS_DAY,
    })
    expect(dueRes.list).toHaveLength(0)
  })


  test('notify-due-stage-dedupe', async () => {
    const due = Date.UTC(2026, 2, 1)
    let now = due - 30 * MS_DAY
    const notified: any[] = []

    const seneca = makeSeneca({
      now: () => now,
      notifyCallback: function (data: any) {
        notified.push(data)
      },
    })

    await seneca.post('sys:calendar,add:event', {
      key: 'token-rot',
      due,
      remindBefore: [30 * MS_DAY, 7 * MS_DAY, MS_DAY],
    })

    // At 30d threshold — one emission
    now = due - 30 * MS_DAY
    let res = await seneca.post('sys:calendar,notify:due')
    expect(res.notified).toHaveLength(1)
    expect(res.notified[0].stages).toEqual([30 * MS_DAY])
    expect(notified).toHaveLength(1)

    // Poll again inside same stage — no re-emit
    res = await seneca.post('sys:calendar,notify:due')
    expect(res.notified).toHaveLength(0)
    expect(notified).toHaveLength(1)

    // Cross 7d — only the new stage
    now = due - 7 * MS_DAY
    res = await seneca.post('sys:calendar,notify:due')
    expect(res.notified).toHaveLength(1)
    expect(res.notified[0].stages).toEqual([7 * MS_DAY])
    expect(notified).toHaveLength(2)

    // Cross due (stage 0) and 1d together if we jump past both
    now = due
    res = await seneca.post('sys:calendar,notify:due')
    expect(res.notified[0].stages.sort((a: number, b: number) => b - a)).toEqual([
      MS_DAY,
      0,
    ])
  })


  test('notify-hook', async () => {
    const due = Date.UTC(2026, 3, 1)
    const now = due
    const hookPayloads: any[] = []

    const seneca = makeSeneca({ now: () => now })

    seneca.message('sys:calendar,hook:notify', async function (msg: any) {
      hookPayloads.push(msg)
      return { ok: true, via: 'hook' }
    })

    await seneca.post('sys:calendar,add:event', {
      key: 'hook-ev',
      due,
      remindBefore: [],
    })

    const res = await seneca.post('sys:calendar,notify:due')
    expect(res.notified).toHaveLength(1)
    expect(hookPayloads).toHaveLength(1)
    expect(hookPayloads[0].event.key).toBe('hook-ev')
    expect(hookPayloads[0].stages).toContain(0)
  })


  test('ack-recurrence-rollover-and-stage-reset', async () => {
    const due = Date.UTC(2026, 0, 10)
    let now = due
    const seneca = makeSeneca({ now: () => now })

    await seneca.post('sys:calendar,add:event', {
      key: 'weekly-check',
      due,
      recurrence: 'weekly',
      remindBefore: [MS_DAY],
    })

    // Fire notify so stages are recorded
    await seneca.post('sys:calendar,notify:due')
    let get0 = await seneca.post('sys:calendar,get:event,key:weekly-check')
    expect(get0.event.notifiedStages.length).toBeGreaterThan(0)

    const ack0 = await seneca.post('sys:calendar,ack:event,key:weekly-check')
    expect(ack0).toMatchObject({
      ok: true,
      event: {
        status: 'active',
        due: due + 7 * MS_DAY,
        notifiedStages: [],
        lastNotified: null,
      },
    })

    // Non-recurring → done
    await seneca.post('sys:calendar,add:event', {
      key: 'once',
      due,
      recurrence: 'none',
    })
    const ack1 = await seneca.post('sys:calendar,ack:event,key:once')
    expect(ack1).toMatchObject({
      ok: true,
      event: { status: 'done', notifiedStages: [] },
    })

    // Done events are not due
    now = due + 1000
    const dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes.list.find((e: any) => e.key === 'once')).toBeUndefined()
  })


  test('monthly-yearly-calendar-arithmetic', () => {
    // Jan 31 + 1 month → last day of Feb
    const jan31 = Date.UTC(2026, 0, 31, 12, 0, 0)
    const feb = new Date(nextDue(jan31, 'monthly'))
    expect(feb.getUTCFullYear()).toBe(2026)
    expect(feb.getUTCMonth()).toBe(1)
    expect(feb.getUTCDate()).toBe(28)

    // Feb 28 + 1 year → Feb 28
    const feb28 = Date.UTC(2025, 1, 28, 12, 0, 0)
    const nextYear = new Date(nextDue(feb28, 'yearly'))
    expect(nextYear.getUTCFullYear()).toBe(2026)
    expect(nextYear.getUTCMonth()).toBe(1)
    expect(nextYear.getUTCDate()).toBe(28)

    // interval-ms is fixed
    expect(nextDue(1000, 'interval-ms', 500)).toBe(1500)
    expect(nextDue(1000, 'daily')).toBe(1000 + MS_DAY)
  })


  test('monthly-ack-no-drift', async () => {
    const due = Date.UTC(2026, 0, 31, 15, 0, 0)
    const seneca = makeSeneca({ now: () => due })

    await seneca.post('sys:calendar,add:event', {
      key: 'monthly-cert',
      due,
      recurrence: 'monthly',
    })

    const ack0 = await seneca.post('sys:calendar,ack:event,key:monthly-cert')
    const rolled = new Date(ack0.event.due)
    expect(rolled.getUTCMonth()).toBe(1)
    expect(rolled.getUTCDate()).toBe(28)
    expect(rolled.getUTCHours()).toBe(15)
  })


  test('snooze-resets-stages-and-hides-from-due', async () => {
    const due = Date.UTC(2026, 4, 1)
    let now = due - MS_HOUR
    const seneca = makeSeneca({ now: () => now })

    await seneca.post('sys:calendar,add:event', {
      key: 'snooze-me',
      due,
      remindBefore: [2 * MS_HOUR],
    })

    await seneca.post('sys:calendar,notify:due')
    let get0 = await seneca.post('sys:calendar,get:event,key:snooze-me')
    expect(get0.event.notifiedStages.length).toBeGreaterThan(0)

    const until = due + 2 * MS_DAY
    const snooze0 = await seneca.post('sys:calendar,snooze:event', {
      key: 'snooze-me',
      until,
    })
    expect(snooze0).toMatchObject({
      ok: true,
      event: {
        status: 'snoozed',
        snoozeUntil: until,
        notifiedStages: [],
        lastNotified: null,
      },
    })

    let dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes.list).toHaveLength(0)

    // Still snoozed before until
    now = due + MS_DAY
    dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes.list).toHaveLength(0)

    // After snoozeUntil, due again and notify can fire stages fresh
    now = until + 1
    dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes.list).toHaveLength(1)

    const notified: any[] = []
    seneca.message('sys:calendar,hook:notify', async function (msg: any) {
      notified.push(msg)
      return { ok: true }
    })

    const nres = await seneca.post('sys:calendar,notify:due')
    expect(nres.notified.length).toBe(1)
    expect(notified.length).toBe(1)
  })


  test('crossedStages-helper', () => {
    const due = 1_000_000
    expect(crossedStages(due, [1000, 100], due - 2000)).toEqual([])
    expect(crossedStages(due, [1000, 100], due - 1000)).toEqual([1000])
    expect(crossedStages(due, [1000, 100], due - 50)).toEqual([1000, 100])
    expect(crossedStages(due, [1000, 100], due)).toEqual([1000, 100, 0])
  })


  test('tick-clears-on-close', async () => {
    const seneca = makeSeneca({
      tick: { active: true, interval: 60_000 },
    })
    await seneca.ready()

    await new Promise<void>((resolve, reject) => {
      seneca.close((err: any) => (err ? reject(err) : resolve()))
    })
    // If the interval leaked, Jest would hang; reaching here is the assertion.
    expect(true).toBe(true)
  })
})


function makeSeneca(opts: any = {}) {
  const seneca = Seneca({ legacy: false })
    .test()
    .use('promisify')
    .use('entity')
    .use(Calendar, opts)
  return seneca
}
