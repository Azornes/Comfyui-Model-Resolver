# Backend custom-node model adapters

Backend integrations for non-standard workflow node formats live here.

Each adapter declares its node types, category hints, and fixed widget
categories. Optional hooks can provide:

- custom workflow reference extraction;
- lightweight potential-reference detection;
- custom workflow path updates;
- existing-reference filtering;
- Loaded Models display adjustments.

Register new adapters in `registry.py`. Generic dictionary-backed model fields,
including `nested_key`, stay in the shared analyzer and updater because they are
not specific to one node package.
