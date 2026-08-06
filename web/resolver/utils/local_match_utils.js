export function classifyLocalMatches(
    matches = [],
    { minConfidence = 70, perfectConfidence = 100, visibleLimit = 5 } = {},
) {
    const filteredMatches = matches.filter(match => match.confidence >= minConfidence);
    const perfectMatches = filteredMatches.filter(match => match.confidence === perfectConfidence);
    const otherMatches = filteredMatches.filter(
        match => match.confidence < perfectConfidence && match.confidence >= minConfidence,
    );
    const visibleMatches = perfectMatches.length > 0
        ? perfectMatches
        : [...otherMatches].sort((left, right) => right.confidence - left.confidence).slice(0, visibleLimit);

    return {
        filteredMatches,
        perfectMatches,
        otherMatches,
        visibleMatches,
        hasMatches: filteredMatches.length > 0,
    };
}
