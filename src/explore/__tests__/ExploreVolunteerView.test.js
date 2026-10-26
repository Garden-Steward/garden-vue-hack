import { describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ExploreVolunteerView from '../ExploreVolunteerView.vue';
import { computeHealth } from '../health';
import { volunteersOf } from '../people';

vi.mock('@/stores', () => ({
    useAuthStore: () => ({ user: { value: null } }),
    useGardenTaskStore: () => ({ assignTaskViaSMS: vi.fn(async () => ({ success: true })), joinReserve: vi.fn(async () => ({ position: 1 })) })
}));
vi.mock('pinia', () => ({ storeToRefs: (s) => s }));

const RouterLink = { props: ['to'], template: '<a><slot /></a>' };
const maya = { id: 1, firstName: 'Maya', lastName: 'Kim' };
const ravi = { id: 3, firstName: 'Ravi', lastName: 'Patel' };
const task = (id, title, max, volunteers = [], extra = {}) => ({ id, title, max_volunteers: max, volunteers, reserves: [], dropped: [], ...extra });

const TASKS = [
    task(1, 'Water the kale bed', 3, [maya]),
    task(2, 'Stake passion fruit vine', 2, [ravi, { id: 5 }], { reserves: [{ id: 6 }] })
];
const EVENT = { id: 9, title: 'Seed Starting Workshop', startDatetime: '2026-10-31T14:00:00', confirmed: [{ id: 1 }, { id: 7, firstName: 'Tess', lastName: 'N' }] };

function build(props = {}) {
    const user = props.user ?? null;
    const tasks = props.tasks ?? TASKS;
    return mount(ExploreVolunteerView, {
        props: {
            gardenSlug: 'downtown',
            nextEvent: EVENT,
            laterEvents: [{ id: 10, title: 'November 3rd Sunday', startDatetime: '2026-11-15T10:00:00' }],
            eventCount: 14,
            tasks,
            health: computeHealth([]),
            people: volunteersOf({ tasks, history: [], event: EVENT, userId: user?.id ?? null }),
            figures: [],
            ...props
        },
        global: { stubs: { RouterLink } }
    });
}

describe('ExploreVolunteerView', () => {
    test('shows the next workday, who is going, the help summary and the right button per task', () => {
        const w = build();
        expect(w.find('[data-test="next"]').text()).toContain('Seed Starting Workshop');
        expect(w.find('[data-test="next"]').text()).toContain('2 going');
        expect(w.find('[data-test="help"]').text()).toContain('Help needed · 2 tasks');
        const claim = w.find('[data-test="claim"]');
        expect(claim.attributes('aria-label')).toBe('I can help with Water the kale bed');
        const reserve = w.find('[data-test="join-reserve"]');
        expect(reserve.text()).toBe('Join reserve');
        expect(w.find('[data-test="help"]').text()).toContain('Full · 1 on reserve');
    });

    test('I can help opens the sign-up; close brings the list back', async () => {
        const w = build();
        await w.find('[data-test="claim"]').trigger('click');
        const one = w.find('[data-test="one"]');
        expect(one.text()).toContain('Water the kale bed');
        expect(one.text()).toContain('2 spots open');
        expect(one.find('input[type="tel"]').exists()).toBe(true);
        expect(one.find('[data-test="submit"]').text()).toBe('Sign up');
        await one.find('button[aria-label="Back to all tasks"]').trigger('click');
        expect(w.find('[data-test="one"]').exists()).toBe(false);
        expect(w.find('[data-test="claim"]').exists()).toBe(true);
    });

    test('a full task opens the reserve-list form', async () => {
        const w = build();
        await w.find('[data-test="join-reserve"]').trigger('click');
        const one = w.find('[data-test="one"]');
        expect(one.find('[data-test="submit"]').text()).toBe('Join reserve list');
        expect(one.text()).toContain('1 person is ahead of you');
    });

    test('signed in and on a task: Mark done and a confirmed Can’t make it', async () => {
        const w = build({ user: maya });
        const mine = w.find('[data-test="mine"]');
        expect(mine.text()).toBe("Can't make it");
        expect(w.find('[data-test="help"]').text()).toContain("you're on it");
        await mine.trigger('click');
        const one = w.find('[data-test="one"]');
        expect(one.text()).toContain("You're signed up");
        await one.find('[data-test="leave"]').trigger('click');
        expect(w.find('[data-test="confirm-leave"]').exists()).toBe(true);
        await w.find('[data-test="confirm"]').trigger('click');
        expect(w.emitted('leave')[0][0].id).toBe(1);
        // Busy until the parent reports back: no second action can fire meanwhile.
        expect(w.find('[data-test="confirm"]').attributes('disabled')).toBeDefined();
    });

    test('signed in and on a task: Mark done emits finish', async () => {
        const w = build({ user: maya });
        await w.find('[data-test="mine"]').trigger('click');
        await w.find('[data-test="finish"]').trigger('click');
        expect(w.emitted('finish')[0][0].id).toBe(1);
    });

    test('signed in and on a reserve list: shows position and lets you leave', async () => {
        const tasks = [task(2, 'Stake passion fruit vine', 2, [ravi, { id: 5 }], { reserves: [{ id: 6 }, maya] })];
        const w = build({ user: maya, tasks });
        expect(w.find('[data-test="help"]').text()).toContain("you're 2nd on reserve");
        await w.find('[data-test="reserved"]').trigger('click');
        await w.find('[data-test="leave-reserve"]').trigger('click');
        expect(w.emitted('leave-reserve')[0][0].id).toBe(2);
    });

    test('RSVP emits; once going, a signed-in user can say they can’t make it', async () => {
        const w = build();
        await w.find('[data-test="rsvp"]').trigger('click');
        expect(w.emitted('rsvp')).toHaveLength(1);
        await w.setProps({ rsvped: true });
        expect(w.find('[data-test="rsvp"]').text()).toContain("You're going");
        expect(w.find('[data-test="unrsvp"]').exists()).toBe(false);
        await w.setProps({ user: maya });
        await w.find('[data-test="unrsvp"]').trigger('click');
        expect(w.emitted('unrsvp')).toHaveLength(1);
    });

    test('health card shows the badge, streak and 14 days; overdue tasks sort first', () => {
        const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
        const history = [
            ...Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, title: 'Water', recurring_task: { id: 1 }, createdAt: day(i + 3), task_status: 'FINISHED', completed_at: day(i + 3) })),
            { id: 1, title: 'Water the kale bed', recurring_task: { id: 1 }, createdAt: day(2), task_status: 'INITIALIZED' },
            { id: 2, title: 'Stake passion fruit vine', recurring_task: { id: 2 }, createdAt: day(1), task_status: 'INITIALIZED' }
        ];
        const w = build({ health: computeHealth(history) });
        const h = w.find('[data-test="health"]');
        expect(h.text()).toContain('Needs hands');
        expect(h.findAll('.exv__days i')).toHaveLength(14);
        expect(h.text()).toContain('2 tasks missed in the last 3 days');
        const titles = w.findAll('.exv__task-title').map(x => x.text());
        expect(titles[0]).toBe('Water the kale bed'); // overdue 2 days sorts before overdue 1 day
        expect(w.find('[data-test="help"]').text()).toContain('Overdue · 2 days');
    });

    test('people on the island become figures at the projected points, with a status in the tooltip', () => {
        const w = build({ figures: [{ x: 100, y: 50, visible: true }, { x: 200, y: 60, visible: false }, { x: 1, y: 1, visible: true }, { x: 2, y: 2, visible: true }] });
        const figs = w.findAll('[data-test="figure"]');
        expect(figs.length).toBe(4); // Maya (signed up + going), Ravi and id 5 (signed up), Tess (going); id 6 is only on reserve
        expect(figs[0].attributes('aria-label')).toMatch(/Signed up|Going/);
        expect(figs[1].classes()).toContain('is-hidden');
        expect(w.find('[data-test="people"]').text()).toContain('Volunteers');
    });

    test('only managers get the Manage pill, and it emits', async () => {
        expect(build().find('[data-test="manage"]').exists()).toBe(false);
        const w = build({ canManage: true });
        await w.find('[data-test="manage"]').trigger('click');
        expect(w.emitted('manage')).toHaveLength(1);
    });

    test('renders nothing for workdays or tasks when there are none', () => {
        const w = build({ nextEvent: null, laterEvents: [], eventCount: 0, tasks: [], people: [] });
        expect(w.find('[data-test="next"]').exists()).toBe(false);
        expect(w.find('[data-test="help"]').exists()).toBe(false);
    });

    test('the sheet toggles between peek and half', async () => {
        const w = build();
        expect(w.classes()).toContain('is-peek');
        await w.find('[data-test="toggle"]').trigger('click');
        expect(w.classes()).toContain('is-half');
        await w.find('[data-test="toggle"]').trigger('click');
        expect(w.classes()).toContain('is-peek');
    });
});
