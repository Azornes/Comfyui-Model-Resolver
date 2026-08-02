# Backend architecture

Model Resolver keeps the ComfyUI entry point small and separates HTTP wiring from
the feature logic that powers each route.

## Runtime flow

1. `__init__.py` exposes the ComfyUI compatibility exports and initializes the
   extension.
2. `core/extension.py` owns runtime state such as progress trackers and starts
   route registration.
3. `core/routes/registry.py` loads the available integrations and builds a
   `RouteContext` with explicit dependencies.
4. Modules in `core/routes/` adapt HTTP requests and responses to service calls.
5. Services in `core/services/` contain feature behavior and receive their
   dependencies through `RouteContext`.

Route registration imports the concrete route modules directly. The actual
handlers live in focused route adapters and services; no compatibility grouping
layer is kept for this application-only package.

## Workflow analysis package

Workflow inspection is grouped under `core/workflow/` and is deliberately kept
separate from HTTP routes and workflow mutation:

- `widgets.py` contains static node-type and widget-position knowledge.
- `dynamic_widgets.py` discovers runtime widget metadata from ComfyUI nodes.
- `references.py` extracts model references and resolves local paths.
- `subgraphs.py` handles subgraph indexes and promoted inputs.
- `analysis.py` traverses workflows and aggregates missing-model results.
- `inventory.py` builds the cached inventory used by repeated analyses.

The dependency direction is layered: widget definitions are the base, dynamic
widget discovery builds on them, references consume both, subgraph handling
consumes references and widget definitions, analysis composes references and
subgraphs, and inventory consumes analysis. The package does not depend on
route adapters or services. `core/workflow_updater.py` remains a separate
writer used after resolution; it is not part of read-only workflow analysis.

When adding workflow behavior, place it in the narrowest component that owns
the responsibility and add a focused test in `tests/test_workflow_components.py`
or `tests/test_workflow_analyzer.py`. Keep imports within the documented layer
direction; `tests/test_workflow_boundaries.py` enforces this contract.

## Frontend architecture

The frontend keeps ComfyUI-specific integration at the extension boundary in
`web/model_resolver.js` and composes the dialog behavior in
`web/resolver/resolver_dialog.js`. The dialog is assembled from focused method
groups:

1. `web/resolver/shell/` owns lifecycle, workflow identity, and tab state.
2. `web/resolver/search/` owns source selection, search state, aliases, and hash
   matching.
3. `web/resolver/views/` owns view-specific state such as missing models and
   model information.
4. `web/resolver/downloads/` owns queue storage and download progress policy.
5. `web/resolver/utils/` owns shared API, keybinding, and browser helpers.

Pure policies and state transitions are exported as small ES modules so they
can be tested without booting ComfyUI. The extension entry point and the dialog
composition are covered separately as integration contracts.

## Adding a route

When adding a feature, keep the request parsing, status codes, and JSON response
in a route adapter. Put reusable behavior in a service and add its dependency to
`RouteContext` explicitly. Use `json_api_endpoint` for the common error boundary,
and preserve deliberate `aiohttp.web.HTTPException` statuses when returning
client errors.

Add a focused route/service test before changing behavior. For changes that touch
route registration or shared backend code, run the complete Python suite as well.

## Local verification

For frontend changes, run these commands from the project directory:

```powershell
npm test
npm run test:coverage
npm run lint
```

`test:coverage` uses Node's built-in test coverage reporter and prints the
current statement, branch, and function coverage. It is an inspection report,
not a hard threshold, because runtime-only ComfyUI adapters cannot be fully
exercised outside the host application.

## Pull request checks

The repository workflow lives in `.github/workflows/ci.yml`. It runs the
frontend and backend checks for pull requests whose source repository is
outside this repository, which keeps automated validation focused on external
contributions. It does not run for direct pushes to `main`; local changes by
the maintainer should use the verification commands above before committing.

The workflow uses the tracked `package-lock.json` with `npm ci`, has read-only
repository permissions, and does not require secrets. Its two jobs run:

1. `npm test` and `npm run lint` for the frontend.
2. The Python suite with branch coverage for `core.workflow`, Ruff, and
   `compileall` for the backend.

The backend job requires at least 75% coverage for `core.workflow` and uploads
the XML report as the `workflow-coverage` artifact. The threshold is scoped to
the refactored workflow package while the remaining legacy backends are being
covered incrementally.

The workflow uses `pull_request`, not `pull_request_target`, so code from an
external fork is tested with the restricted pull-request token context.

Run these commands with the same Python interpreter used by ComfyUI:

```powershell
python -m pytest
python -m ruff check __init__.py core
python -m compileall -q __init__.py core
python -m coverage run -m pytest
python -m coverage report -m
```

The development tools are declared in the `dev` optional dependency group in
`pyproject.toml`. Coverage configuration is kept there as well, with branch
coverage enabled and `core/` as the measured source.
