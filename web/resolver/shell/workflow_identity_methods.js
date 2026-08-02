import { getCustomNodeOriginalIdentity } from "../custom_nodes/registry.js";

export const workflowIdentityMethods = {
    encodeMissingModelKeyPart(value) {
        return encodeURIComponent(String(value ?? '').trim());
    },

    getMissingModelIdentityPart(missing = {}) {
        return getCustomNodeOriginalIdentity(missing)
            || missing.original_path
            || missing.expected_filename
            || missing.name
            || missing.filename
            || missing.urn_string
            || '';
    },

    getMissingModelKey(missing = {}) {
        if (missing.missing_key) {
            return String(missing.missing_key);
        }

        const nodeId = missing.node_id ?? '';
        const widgetIndex = missing.widget_index ?? '';
        const subgraphId = missing.subgraph_id || '';
        const scope = missing.is_top_level !== false ? 'T' : 'F';
        const nestedKey = missing.nested_key || '';
        const category = missing.category || '';
        const identity = this.getMissingModelIdentityPart(missing);
        return [
            nodeId,
            widgetIndex,
            subgraphId,
            scope,
            nestedKey,
            category,
            identity
        ].map(value => this.encodeMissingModelKeyPart(value)).join(':');
    },

    getMissingModelWorkflowSlotKeys(missing = {}) {
        const references = [missing];
        if (Array.isArray(missing.all_node_refs)) {
            references.push(...missing.all_node_refs);
        }

        const seen = new Set();
        const keys = [];
        for (const reference of references) {
            const nodeId = reference?.node_id;
            if (nodeId === undefined || nodeId === null || nodeId === '') continue;

            const scope = reference.is_top_level !== false ? 'T' : 'F';
            const key = [
                scope,
                reference.subgraph_id || '',
                nodeId,
                reference.widget_index ?? '',
                reference.nested_key || ''
            ].map(value => this.encodeMissingModelKeyPart(value)).join(':');
            if (seen.has(key)) continue;
            seen.add(key);
            keys.push(key);
        }
        return keys;
    },

    findMissingModelReplacement(previousMissing = {}, missingModels = [], preferredIndex = 0) {
        const previousSlots = this.getMissingModelWorkflowSlotKeys(previousMissing);
        if (!previousSlots.length || !Array.isArray(missingModels) || !missingModels.length) {
            return null;
        }

        const previousSlotPositions = new Map(
            previousSlots.map((slotKey, index) => [slotKey, index])
        );
        let best = null;
        missingModels.forEach((missing, index) => {
            const candidateSlots = this.getMissingModelWorkflowSlotKeys(missing);
            let slotRank = Number.POSITIVE_INFINITY;
            candidateSlots.forEach((slotKey, candidateSlotIndex) => {
                const previousSlotIndex = previousSlotPositions.get(slotKey);
                if (previousSlotIndex === undefined) return;
                slotRank = Math.min(slotRank, previousSlotIndex + candidateSlotIndex);
            });
            if (!Number.isFinite(slotRank)) return;

            const rank = [
                slotRank,
                Math.abs(index - preferredIndex),
                index
            ];
            if (
                !best
                || rank[0] < best.rank[0]
                || (rank[0] === best.rank[0] && rank[1] < best.rank[1])
                || (rank[0] === best.rank[0] && rank[1] === best.rank[1] && rank[2] < best.rank[2])
            ) {
                best = { missing, rank };
            }
        });
        return best?.missing || null;
    },

    resolvePreservedMissingModelKey(missingModels = [], previousMissingModels = [], previousKey = '') {
        if (!previousKey || !Array.isArray(missingModels) || !missingModels.length) return '';

        const exact = missingModels.find(missing => this.getMissingModelKey(missing) === previousKey);
        if (exact) return previousKey;

        const previousIndex = previousMissingModels.findIndex(
            missing => this.getMissingModelKey(missing) === previousKey
        );
        if (previousIndex < 0) return '';

        const replacement = this.findMissingModelReplacement(
            previousMissingModels[previousIndex],
            missingModels,
            previousIndex
        );
        return replacement ? this.getMissingModelKey(replacement) : '';
    },

    remapMissingModelKeys(
        missingModels = [],
        previousMissingModels = [],
        previousKeys = null,
        currentMissingModels = null
    ) {
        const currentKeys = new Set(
            (Array.isArray(currentMissingModels) ? currentMissingModels : missingModels)
                .map(missing => this.getMissingModelKey(missing))
        );
        const remappedKeys = new Set();
        for (const previousKey of previousKeys || []) {
            if (
                currentKeys.has(previousKey)
                && !missingModels.some(missing => this.getMissingModelKey(missing) === previousKey)
            ) {
                continue;
            }
            const nextKey = this.resolvePreservedMissingModelKey(
                missingModels,
                previousMissingModels,
                previousKey
            );
            if (nextKey) remappedKeys.add(nextKey);
        }
        return remappedKeys;
    },

    getMissingModelDomKey(missing = {}) {
        const key = this.getMissingModelKey(missing);
        try {
            return btoa(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        } catch (_e) {
            return key.replace(/[^A-Za-z0-9_-]/g, char => `_${char.charCodeAt(0).toString(16)}_`);
        }
    },
};
