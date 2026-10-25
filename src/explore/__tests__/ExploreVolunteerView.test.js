import { describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ExploreVolunteerView from '../ExploreVolunteerView.vue';

vi.mock('@/stores', () => ({
    useAuthStore: () => ({ user: { value: null } }),
    useGardenTaskStore: () => ({ assignTaskViaSMS: vi.fn(async () => ({ success: true })) })
}));
vi.mock('pinia', () => ({ storeToRefs: (s) => s }));

const RouterLink = { props: ['to'], template: '<a><slot /></a>' };
const task = (id, title, max, taken) => ({ id, title, max_volunteers: max, volunteers: Array.from({ length: taken }, (_, i) => ({ id: i })) });

function build(props = {}) {
    return mount(ExploreVolunteerView, {
        props: {
            gardenSlug: 'downtown',
            nextEvent: { id: 9, title: 'Seed Starting Workshop', startDatetime: '2026-10-31T14:00:00' },
            laterEvents: [{ id: 10, title: 'November 3rd Sunday', startDatetime: '2026-11-15T10:00:00' }],
            eventCount: 14,
            tasks: [task(1, 'Water the kale bed', 3, 1), task(2, 'Stake passion fruit vine', 2, 2)],
            ...props
        },
        global: { stubs: { RouterLink } }
    });
}

describe('ExploreVolunteerView', () => {
    test('shows the next workday, the help summary and one claim button per task', () => {
        const w = build();
        expect(w.find('[data-test="next"]').text()).toContain('Seed Starting Workshop');
        expect(w.find('[data-test="help"]').text()).toContain('Help needed · 2 tasks');
        const claims = w.findAll('[data-test="claim"]');
        expect(claims).toHaveLength(2);
        expect(claims[0].attributes('aria-label')).toBe('I can help with Water the kale bed');
        expect(claims[0].text()).toBe('I can help');
        expect(claims[1].text()).toBe('Full');
        expect(claims[1].attributes('disabled')).toBeDefined();
    });

    test('I can help swaps the list for that task and its sign-up; close brings the list back', async () => {
        const w = build();
        await w.findAll('[data-test="claim"]')[0].trigger('click');
        const one = w.find('[data-test="one"]');
        expect(one.exists()).toBe(true);
        expect(one.text()).toContain('Water the kale bed');
        expect(one.text()).toContain('2 spots open');
        expect(one.find('input[type="tel"]').exists()).toBe(true);
        await one.find('button[aria-label="Back to all tasks"]').trigger('click');
        expect(w.find('[data-test="one"]').exists()).toBe(false);
        expect(w.findAll('[data-test="claim"]')).toHaveLength(2);
    });

    test('RSVP emits and reflects the going state', async () => {
        const w = build();
        await w.find('[data-test="rsvp"]').trigger('click');
        expect(w.emitted('rsvp')).toHaveLength(1);
        await w.setProps({ rsvped: true });
        expect(w.find('[data-test="rsvp"]').text()).toBe("You're going");
    });

    test('only managers get the Manage pill, and it emits', async () => {
        expect(build().find('[data-test="manage"]').exists()).toBe(false);
        const w = build({ canManage: true });
        await w.find('[data-test="manage"]').trigger('click');
        expect(w.emitted('manage')).toHaveLength(1);
    });

    test('renders nothing for workdays or tasks when there are none', () => {
        const w = build({ nextEvent: null, laterEvents: [], eventCount: 0, tasks: [] });
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
