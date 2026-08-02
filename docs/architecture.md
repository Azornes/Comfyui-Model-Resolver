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

## Adding a route

When adding a feature, keep the request parsing, status codes, and JSON response
in a route adapter. Put reusable behavior in a service and add its dependency to
`RouteContext` explicitly. Use `json_api_endpoint` for the common error boundary,
and preserve deliberate `aiohttp.web.HTTPException` statuses when returning
client errors.

Add a focused route/service test before changing behavior. For changes that touch
route registration or shared backend code, run the complete Python suite as well.

## Local verification

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
