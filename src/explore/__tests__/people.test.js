import { describe, expect, test } from 'vitest';
import { myStanding, personInitials, personName, reservePosition, volunteersOf } from '../people';

const NOW = new Date(2026, 9, 25, 15, 0, 0);
const ago = (hours) => new Date(NOW.getTime() - hours * 3600 * 1000).toISOString();
const maya = { id: 1, firstName: 'Maya', lastName: 'Kim', color: 'green' };
const alex = { id: 2, firstName: 'Alex', lastName: 'Lee' };
const ravi = { id: 3, firstName: 'Ravi', lastName: 'Patel' };
const jo = { id: 4, firstName: 'Jo', lastName: 'Oduya' };

const tasks = [
    { id: 10, title: 'Water the kale bed', max_volunteers: 2, volunteers: [maya], reserves: [], dropped: [{ user: 4, at: ago(30) }] },
    { id: 11, title: 'Harvest lemons', max_volunteers: 2, volunteers: [ravi, { id: 5 }], reserves: [maya, { id: 6 }], reserve_offer_user: 1, dropped: [{ user: 2, at: ago(24 * 10) }] }
];
const history = [
    { id: 20, title: 'Water the tomato rows', task_status: 'FINISHED', completed_at: ago(2), volunteers: [alex] },
    { id: 21, title: 'Weed the paths', task_status: 'FINISHED', completed_at: ago(24 * 3), volunteers: [alex, ravi] },
    { id: 22, title: 'Old job', task_status: 'FINISHED', completed_at: ago(24 * 20), volunteers: [jo] }
];
const event = { id: 9, title: 'Seed Starting Workshop', confirmed: [{ id: 1 }, { id: 7, firstName: 'Tess', lastName: 'N' }] };

describe('volunteersOf', () => {
    test('merges everyone with their statuses, you first, done before signed up', () => {
        const people = volunteersOf({ tasks, history, event, userId: 1, now: NOW });
        const ids = people.map(p => p.id);
        expect(ids[0]).toBe(1);
        const m = people.find(p => p.id === 1);
        expect(m.me).toBe(true);
        expect(m.statuses).toEqual(expect.arrayContaining(['signedUp', 'reserve', 'going']));
        expect(m.primary).toBe('signedUp');
        expect(m.name).toBe('Maya K.');
        expect(m.initials).toBe('MK');
        expect(m.onIsland).toBe(true);

        const a = people.find(p => p.id === 2);
        expect(a.primary).toBe('doneToday');
        expect(a.doneCount).toBe(2);
        expect(a.statuses).not.toContain('dropped'); // dropped 10 days ago: forgotten

        const r = people.find(p => p.id === 3);
        expect(r.primary).toBe('done');
        expect(r.onIsland).toBe(true);

        const j = people.find(p => p.id === 4);
        expect(j.primary).toBe('dropped');
        expect(j.onIsland).toBe(false);
        expect(j.doneCount).toBe(0); // 20-day-old completion doesn't count

        const t = people.find(p => p.id === 7);
        expect(t.primary).toBe('going');
        expect(t.onIsland).toBe(true);

        const six = people.find(p => p.id === 6);
        expect(six.primary).toBe('reserve');
        expect(six.onIsland).toBe(false);
        expect(six.name).toBe('');
    });

    test('ranks done-today above done above signed up above going', () => {
        const people = volunteersOf({ tasks, history, event, userId: null, now: NOW });
        const order = people.map(p => p.primary);
        expect(order.indexOf('doneToday')).toBeLessThan(order.indexOf('done'));
        expect(order.indexOf('done')).toBeLessThan(order.indexOf('signedUp'));
        expect(order.indexOf('signedUp')).toBeLessThan(order.indexOf('going'));
    });
});

describe('myStanding', () => {
    test('on, offered, reserve, none', () => {
        expect(myStanding(tasks[0], 1)).toBe('on');
        expect(myStanding(tasks[1], 1)).toBe('offered');
        expect(myStanding(tasks[1], 6)).toBe('reserve');
        expect(myStanding(tasks[1], 2)).toBe('none');
        expect(myStanding(tasks[1], null)).toBe('none');
        expect(reservePosition(tasks[1], 6)).toBe(2);
    });
});

describe('names', () => {
    test('first name and last initial, with fallbacks', () => {
        expect(personName({ firstName: 'Maya', lastName: 'Kim' })).toBe('Maya K.');
        expect(personName({ username: 'maya' })).toBe('maya');
        expect(personInitials({ firstName: 'Maya', lastName: 'Kim' })).toBe('MK');
        expect(personInitials({})).toBe('?');
    });
});
