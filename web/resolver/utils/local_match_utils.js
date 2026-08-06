import { normalizePathIdentity } from './html_utils.js';

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

export function matchesLocalModelDownload(
    match = {},
    {
        info = {},
        progress = {},
        statusSnapshot = {},
        includeStatusSnapshot = false,
    } = {},
) {
    const model = match.model || {};
    const downloadInfo = info || {};
    const downloadProgress = progress || {};
    const downloadSnapshot = statusSnapshot || {};
    const normalizePath = normalizePathIdentity;
    const joinPath = (...parts) => normalizePath(parts.filter(Boolean).join('/'));
    const filename = downloadProgress.filename || downloadInfo.filename || '';
    const matchAbsolutePaths = [
        model.path,
        model.resolved_path,
        match.path,
        match.resolved_path
    ].map(normalizePath).filter(Boolean);
    const matchRelativePaths = [
        model.relative_path,
        match.relative_path
    ].map(normalizePath).filter(Boolean);
    const targetAbsolutePaths = [
        downloadProgress.path,
        downloadInfo.downloadPath,
        ...(includeStatusSnapshot ? [downloadSnapshot.downloadPath] : []),
        joinPath(downloadProgress.directory || '', filename),
        joinPath(downloadInfo.downloadDirectory || '', filename),
        ...(includeStatusSnapshot ? [joinPath(downloadSnapshot.downloadDirectory || '', filename)] : [])
    ].map(normalizePath).filter(Boolean);
    const targetRelativePaths = [
        downloadInfo.subfolder && filename ? joinPath(downloadInfo.subfolder, filename) : '',
        downloadProgress.relative_path,
        downloadInfo.relativePath
    ].map(normalizePath).filter(Boolean);

    return targetAbsolutePaths.some(target => (
        matchAbsolutePaths.includes(target)
        || matchRelativePaths.some(relative => target.endsWith(`/${relative}`))
    )) || targetRelativePaths.some(target => (
        matchRelativePaths.includes(target)
        || matchAbsolutePaths.some(absolute => absolute.endsWith(`/${target}`))
    ));
}
