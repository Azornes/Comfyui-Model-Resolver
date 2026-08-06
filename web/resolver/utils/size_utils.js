export function parseFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}
