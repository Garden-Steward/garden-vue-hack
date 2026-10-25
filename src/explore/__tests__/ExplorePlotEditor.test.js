import { describe, expect, test, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ExplorePlotEditor from '../ExplorePlotEditor.vue';
import { fetchWrapper } from '@/helpers';

vi.mock('@/helpers', () => ({
    fetchWrapper: { put: vi.fn(async () => ({ data: { plots: [], schematic: { rows: null, path: 'centre', trees: 2 } } })) }
}));
vi.mock('@/stores', () => ({ useAlertStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

describe('ExplorePlotEditor', () => {
    test('controlled mode emits saved with plots and schematic and makes no request', async () => {
        const w = mount(ExplorePlotEditor, {
            props: {
                gardenSlug: null,
                plots: [{ label: 'A', plant: null, piece: 0 }],
                pieces: ['Lot 1', 'Lot 2'],
                schematic: { rows: 2, path: 'left', trees: 1 }
            }
        });
        await w.find('[data-test="save"]').trigger('click');
        await flushPromises();
        expect(fetchWrapper.put).not.toHaveBeenCalled();
        expect(w.emitted('saved')[0][0]).toEqual({
            plots: [{ label: 'A', plant: null, piece: 0 }],
            schematic: { rows: 2, path: 'left', trees: 1 }
        });
    });

    test('piece select appears only with more than one piece', () => {
        const one = mount(ExplorePlotEditor, { props: { gardenSlug: null, plots: [{ label: 'A', plant: null }], pieces: ['Only'] } });
        expect(one.find('[data-test="piece"]').exists()).toBe(false);
        const two = mount(ExplorePlotEditor, { props: { gardenSlug: null, plots: [{ label: 'A', plant: null }], pieces: ['One', 'Two'] } });
        expect(two.find('[data-test="piece"]').exists()).toBe(true);
    });

    test('with a slug, save PUTs plots with piece and schematic', async () => {
        const w = mount(ExplorePlotEditor, {
            props: { gardenSlug: 'g', plots: [{ label: 'A', plant: { documentId: 'p1', title: 'P' }, piece: 1 }], pieces: ['One', 'Two'] }
        });
        await w.find('[data-test="save"]').trigger('click');
        await flushPromises();
        expect(fetchWrapper.put).toHaveBeenCalledWith(expect.stringMatching(/\/api\/gardens\/g\/plots$/), {
            data: { plots: [{ label: 'A', plant: 'p1', piece: 1 }], schematic: { rows: null, path: 'centre', trees: 2 } }
        });
    });
});
