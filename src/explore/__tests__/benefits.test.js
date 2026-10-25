import { describe, expect, test } from 'vitest';
import { aggregateBenefits, benefitLine } from '../benefits';

const plant = (title, benefits) => ({ title, Benefits: benefits.map(([t, p]) => ({ title: t, potency: p })) });

describe('aggregateBenefits', () => {
    test('merges the same benefit across plants, counts beds, averages strength', () => {
        const rows = aggregateBenefits([
            plant('Tomato', [['Food', 'strong'], ['Pollinators', 'mild']]),
            plant('Kale', [['food', 'profound']]),
            plant('Lavender', [['Pollinators', 'profound'], ['Fragrance & calm', 'strong']]),
            null
        ]);
        expect(rows.map(r => r.title)).toEqual(['Food', 'Pollinators', 'Fragrance & calm']);
        const food = rows[0];
        expect(food).toMatchObject({ count: 2, plants: ['Tomato', 'Kale'], max: 5, total: 9, dots: 5 });
        expect(rows[1]).toMatchObject({ count: 2, dots: 4 }); // (2 + 5) / 2 rounds to 4
        expect(benefitLine(food)).toBe('Food · 2 plants');
        expect(benefitLine(rows[2])).toBe('Fragrance & calm · 1 plant');
    });

    test('two beds of the same plant count twice, but the plant is named once', () => {
        const rows = aggregateBenefits([plant('Tomato', [['Food', 'strong']]), plant('Tomato', [['Food', 'strong']])]);
        expect(rows[0]).toMatchObject({ count: 2, plants: ['Tomato'] });
    });

    test('a plant repeating a benefit, blank titles and unknown potencies are tolerated', () => {
        const rows = aggregateBenefits([plant('Mint', [['Medicinal', 'moderate'], ['medicinal', 'strong'], ['', 'strong'], ['Ground cover', 'huge']])]);
        expect(rows.map(r => [r.title, r.count, r.dots])).toEqual([['Medicinal', 1, 3], ['Ground cover', 1, 1]]);
    });

    test('plants without benefits give nothing', () => {
        expect(aggregateBenefits([{ title: 'Rock' }, { title: 'Weed', Benefits: [] }])).toEqual([]);
        expect(aggregateBenefits()).toEqual([]);
    });
});
