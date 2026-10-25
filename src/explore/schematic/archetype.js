// Matches the Strapi `plant.type` enum.
export const PLANT_TYPES = ['annual', 'perennial', 'herb', 'tree', 'shrub', 'wildflower', 'fungi'];

/** Strapi plants can have no type; draw those as an annual. */
export const archetypeOf = (type) => (PLANT_TYPES.includes(type) ? type : 'annual');
