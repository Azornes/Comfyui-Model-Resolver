export function groupLoadedModelsByCategory(loadedModels = []) {
    const byCategory = {};

    for (const model of loadedModels) {
        const category = model.category || 'unknown';
        if (!byCategory[category]) {
            byCategory[category] = { active: [], inactive: [] };
        }

        const isActive = model.active !== false && model.connected !== false;
        byCategory[category][isActive ? 'active' : 'inactive'].push(model);
    }

    return byCategory;
}

export function buildLoadedModelTokenStrings(
    byCategory,
    getToken,
    { preserveEmptyCategories = false } = {}
) {
    const build = filter => {
        const categoryStrings = Object.entries(byCategory).map(([category, models]) => {
            const selected = filter === 'all'
                ? [...models.active, ...models.inactive]
                : models[filter];
            return selected.map(model => getToken(model, category)).join(' ');
        });

        return (preserveEmptyCategories
            ? categoryStrings
            : categoryStrings.filter(Boolean)
        ).join(' ');
    };

    return {
        active: build('active'),
        inactive: build('inactive'),
        all: build('all'),
    };
}
