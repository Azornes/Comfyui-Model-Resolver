# Custom node model adapters

This directory contains frontend integrations for custom nodes whose model
widgets do not follow ComfyUI's standard widget behavior.

Each adapter exports:

- `id`: stable integration identifier.
- `nodeTypes`: supported ComfyUI node type names.
- `category`: default model category for download targeting.
- `isModelWidget(widgetName)`: identifies widget changes handled by the adapter.
- `getModelEntries(node)`: returns normalized source data with `identity`,
  `active`, and `strength`.
- `observe(node, notify)`: attaches any node-specific change hooks and calls
  `notify` after a relevant mutation.

Register new adapters in `registry.js`. The registry owns entry normalization
and model-list/strength signatures. Generic workflow refresh, cache, and Loaded
Models rendering stay outside adapters.

Legacy custom-node metadata normalization also stays in the registry so generic
views do not need package-specific field knowledge.
