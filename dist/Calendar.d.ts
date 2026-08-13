export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'interval-ms';
export type Severity = 'info' | 'warn' | 'critical';
export type Status = 'active' | 'acknowledged' | 'snoozed' | 'done';
export type CalendarEvent = {
    key: string;
    kind?: string;
    title?: string;
    description?: string;
    due: number;
    remindBefore: number[];
    recurrence: Recurrence;
    severity: Severity;
    status: Status;
    snoozeUntil?: number | null;
    lastNotified?: number | null;
    notifiedStages: number[];
    assignee?: string | null;
    tags?: string[];
    meta?: Record<string, any>;
    /** For recurrence === 'interval-ms' */
    intervalMs?: number;
};
type CalendarOptionsFull = {
    debug: boolean;
    canon: {
        zone: string | undefined;
        base: string | undefined;
        name: string | undefined;
    };
    /** Injectable clock; defaults to Date.now */
    now: () => number;
    /** Default remind-before offsets (ms) applied when add:event omits remindBefore */
    remindBefore: number[];
    tick: {
        active: boolean;
        interval: number;
    };
    /** Optional delivery callback; also see sys:calendar,hook:notify */
    notifyCallback: (data: any) => any;
};
export type CalendarOptions = Partial<CalendarOptionsFull>;
declare function nextDue(due: number, recurrence: Recurrence, intervalMs?: number): number;
/** Stages (remindBefore values) that have been crossed at `now` relative to `due`. */
declare function crossedStages(due: number, remindBefore: number[], now: number): number[];
declare function Calendar(this: any, options: CalendarOptionsFull): void;
export { nextDue, crossedStages };
export default Calendar;
