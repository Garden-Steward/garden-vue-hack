import { describe, expect, test } from 'vitest';
import { computeHealth, dayKey, healthNudge } from '../health';

const NOW = new Date(2026, 9, 25, 15, 0, 0); // local Sun Oct 25 2026, 3pm
const day = (offset) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - offset, 9, 0, 0);
const rep = (offset, status, extra = {}) => ({ id: Math.random(), title: 'Water', recurring_task: { id: 1 }, createdAt: day(offset).toISOString(), task_status: status, completed_at: status === 'FINISHED' ? day(offset).toISOString() : null, ...extra });
const oneOff = (offset, status) => ({ id: Math.random(), title: 'Fix gate', createdAt: day(offset).toISOString(), task_status: status, completed_at: status === 'FINISHED' ? day(offset).toISOString() : null });

describe('computeHealth', () => {
    test('a quiet garden with no repeating tasks', () => {
        const h = computeHealth([oneOff(1, 'FINISHED')], NOW);
        expect(h.level).toBe('quiet');
        expect(h.streak).toBe(0);
        expect(h.days).toHaveLength(14);
        expect(h.days.every(d => d.state === 'none' || d.state === 'pending')).toBe(true);
        expect(h.doneWeekAll).toBe(1);
    });

    test('every day done for a fortnight is thriving with a 14-day streak', () => {
        const tasks = Array.from({ length: 14 }, (_, i) => rep(i, 'FINISHED'));
        const h = computeHealth(tasks, NOW);
        expect(h.level).toBe('thriving');
        expect(h.streak).toBe(14);
        expect(h.best).toBe(14);
        expect(h.days.at(-1)).toMatchObject({ today: true, state: 'done' });
    });

    test('today not yet done is pending and keeps yesterday’s streak', () => {
        const tasks = [rep(0, 'INITIALIZED'), ...Array.from({ length: 5 }, (_, i) => rep(i + 1, 'FINISHED'))];
        const h = computeHealth(tasks, NOW);
        expect(h.days.at(-1).state).toBe('pending');
        expect(h.streak).toBe(5);
        expect(h.level).toBe('thriving'); // 5 of 5 counted days done
    });

    test('a quiet day in the middle does not break the streak, a missed one does', () => {
        const quiet = [rep(0, 'FINISHED'), rep(1, 'FINISHED'), rep(3, 'FINISHED'), rep(4, 'FINISHED')];
        expect(computeHealth(quiet, NOW).streak).toBe(4);
        const missed = [rep(0, 'FINISHED'), rep(1, 'FINISHED'), rep(2, 'ABANDONED'), rep(3, 'FINISHED'), rep(4, 'FINISHED')];
        const h = computeHealth(missed, NOW);
        expect(h.streak).toBe(2);
        expect(h.best).toBe(2);
        expect(h.days[11].state).toBe('miss');
    });

    test('two missed days out of the last three means needs hands, with the oldest overdue task named', () => {
        const tasks = [
            ...Array.from({ length: 8 }, (_, i) => rep(i + 4, 'FINISHED')),
            rep(3, 'INITIALIZED', { title: 'Water the kale bed' }),
            rep(2, 'INITIALIZED', { title: 'Water the tomatoes' }),
            rep(1, 'FINISHED'),
            rep(0, 'INITIALIZED')
        ];
        const h = computeHealth(tasks, NOW);
        expect(h.level).toBe('needs');
        expect(h.streak).toBe(1);
        expect(h.missedDays).toBe(2);
        expect(h.missedTasks).toBe(2);
        expect(h.overdue[0].task.title).toBe('Water the kale bed');
        expect(h.overdue[0].days).toBe(3);
        expect(healthNudge(h)).toBe('2 tasks missed in the last 3 days. "Water the kale bed" has been waiting 3 days.');
    });

    test('partly done days count as part and read as steady', () => {
        const tasks = [];
        for (let i = 1; i <= 10; i++) {
            tasks.push(rep(i, 'FINISHED'));
            if (i % 3 === 0) tasks.push(rep(i, 'ABANDONED', { recurring_task: { id: 2 } }));
        }
        const h = computeHealth(tasks, NOW);
        expect(h.days.filter(d => d.state === 'part')).toHaveLength(3);
        expect(h.level).toBe('steady');
    });

    test('dayKey is local and zero-padded', () => {
        expect(dayKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    });
});
