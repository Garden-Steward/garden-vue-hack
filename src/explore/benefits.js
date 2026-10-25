// What a garden gives, added up from the benefits of every plant in it.
// Each plant carries `Benefits: [{ title, potency }]` (potency minimal …
// profound). Per garden the same benefit from several plants becomes one row:
// how many beds carry it, which plants, and an average strength in dots.

export const POTENCY = { minimal: 1, mild: 2, moderate: 3, strong: 4, profound: 5 };
export const POTENCY_LABEL = { 1: 'Minimal', 2: 'Mild', 3: 'Moderate', 4: 'Strong', 5: 'Profound' };

const keyOf = (title) => String(title || '').trim().toLowerCase();

/**
 * @param {Array} plants plant records (with `Benefits`), one per bed; nulls are skipped
 * @returns {Array<{ key, title, count, plants, dots, max, total }>} most widespread first
 */
export function aggregateBenefits(plants) {
    const rows = new Map();
    for (const plant of plants || []) {
        if (!plant) continue;
        const seen = new Set(); // a plant listing the same benefit twice still counts once
        for (const b of plant.Benefits || []) {
            const key = keyOf(b?.title);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const score = POTENCY[String(b.potency || '').trim().toLowerCase()] || 0;
            let row = rows.get(key);
            if (!row) {
                row = { key, title: String(b.title).trim(), count: 0, plants: [], max: 0, total: 0 };
                rows.set(key, row);
            }
            row.count++;
            row.total += score;
            row.max = Math.max(row.max, score);
            if (plant.title && !row.plants.includes(plant.title)) row.plants.push(plant.title);
        }
    }
    return [...rows.values()]
        .map(r => ({ ...r, dots: r.count ? Math.max(1, Math.round(r.total / r.count)) : 0 }))
        .sort((a, b) => b.count - a.count || b.total - a.total || a.title.localeCompare(b.title));
}

/** "Food · 4 plants" style line for a row. */
export const benefitLine = (r) => `${r.title} · ${r.count} ${r.count === 1 ? 'plant' : 'plants'}`;
