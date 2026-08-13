"use strict";
/* Copyright © 2024–2026 Seneca Project Contributors, MIT License. */
Object.defineProperty(exports, "__esModule", { value: true });
const docs = {
    messages: {
        msgAddEvent: {
            desc: 'Add a calendar event by key (fails if key exists unless existing:true).',
        },
        msgGetEvent: {
            desc: 'Get a calendar event by key.',
        },
        msgListEvent: {
            desc: 'List calendar events by query.',
        },
        msgUpdateEvent: {
            desc: 'Update fields on an existing calendar event.',
        },
        msgRemoveEvent: {
            desc: 'Remove a calendar event by key.',
        },
        msgDueEvents: {
            desc: 'List active (non-snoozed) events whose remind window has been reached.',
        },
        msgAckEvent: {
            desc: 'Acknowledge an event; recurring events roll due forward and reset notify stages.',
        },
        msgSnoozeEvent: {
            desc: 'Snooze an event until a timestamp; resets notify stages.',
        },
        msgNotifyDue: {
            desc: 'Emit newly-crossed reminder stages via hook:notify and/or notifyCallback.',
        },
    },
};
exports.default = docs;
if ('undefined' !== typeof module) {
    module.exports = docs;
}
//# sourceMappingURL=CalendarDoc.js.map