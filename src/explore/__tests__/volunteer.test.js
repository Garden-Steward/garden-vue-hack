import { describe, expect, test } from 'vitest';
import { helpSummary, laterLine, nextSheetHeight, pickView, spotsLine } from '../volunteer';

const task = (max, taken) => ({ max_volunteers: max, volunteers: Array.from({ length: taken }, (_, i) => ({ id: i + 1 })) });

describe('pickView', () => {
    test('visitors and volunteers always get the volunteer view', () => {
        expect(pickView({ isManager: false })).toBe('volunteer');
        expect(pickView({ isManager: false, override: 'manage' })).toBe('volunteer');
    });
    test('managers land on the workbench unless they chose to preview', () => {
        expect(pickView({ isManager: true })).toBe('manage');
        expect(pickView({ isManager: true, override: 'volunteer' })).toBe('volunteer');
        expect(pickView({ isManager: true, override: 'manage' })).toBe('manage');
    });
});

describe('spotsLine', () => {
    test('counts open spots and treats a missing max as one', () => {
        expect(spotsLine(task(3, 1))).toBe('2 spots open');
        expect(spotsLine(task(2, 1))).toBe('1 spot open');
        expect(spotsLine({ volunteers: [] })).toBe('1 spot open');
    });
    test('reads Full once every spot is taken', () => {
        expect(spotsLine(task(2, 2))).toBe('Full · 2 of 2');
        expect(spotsLine(task(1, 3))).toBe('Full · 3 of 1');
    });
});

describe('helpSummary', () => {
    test('sums spots across tasks', () => {
        const s = helpSummary([task(3, 1), task(2, 2), task(1, 0)]);
        expect(s).toMatchObject({ count: 3, spots: 3, label: 'Help needed · 3 tasks', sub: '3 spots open · tap to see them' });
    });
    test('says so when everything is full', () => {
        expect(helpSummary([task(1, 1)])).toMatchObject({ count: 1, spots: 0, label: 'Help needed · 1 task' });
        expect(helpSummary([task(1, 1)]).sub).toMatch(/^Every spot is taken/);
    });
});

describe('laterLine', () => {
    const day = (iso) => iso.slice(5, 10);
    test('lists the dates, and is empty without any', () => {
        expect(laterLine([{ startDatetime: '2026-11-15' }, { startDatetime: '2026-11-24' }], day)).toBe('Next workdays: 11-15, 11-24');
        expect(laterLine([], day)).toBe('');
    });
});

describe('nextSheetHeight', () => {
    test('steps through peek, half, full and clamps at the ends', () => {
        expect(nextSheetHeight('peek', 'up')).toBe('half');
        expect(nextSheetHeight('half', 'up')).toBe('full');
        expect(nextSheetHeight('full', 'up')).toBe('full');
        expect(nextSheetHeight('full', 'down')).toBe('half');
        expect(nextSheetHeight('peek', 'down')).toBe('peek');
        expect(nextSheetHeight('nonsense', 'up')).toBe('half');
    });
});
