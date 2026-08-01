# Model Resolver - CSS Architecture & Design Tokens

This directory contains the core stylesheets and token system for the `comfyui-model-resolver` extension.

## Stylesheet Structure

- **`css-variables.css`**: Central design system token registry (`:root`). All colors, dimensions, spacing, typography, z-indexes, and animations MUST be defined here.
- **`resolver-main.css`**: Styles for the main dialog, missing models browser, tab contents, lists, and model details views.
- **`resolver-shell.css`**: Styles for the outer modal shell, sidebar docking panel, window controls, and queue drawer.

## Usage Guidelines

1. **Always Use CSS Variables**:
   Avoid using raw hex colors (e.g. `#111111`, `#4caf50`) or hardcoded pixel values when a variable exists.
   - Backgrounds: `var(--mr-bg)`, `var(--mr-bg-soft)`, `var(--mr-card-bg)`, `var(--mr-panel-bg)`
   - Text Colors: `var(--mr-text)`, `var(--mr-text-muted)`, `var(--mr-text-dim)`, `var(--mr-text-soft)`
   - Accent & Status: `var(--mr-accent)`, `var(--mr-warning)`, `var(--mr-color-civitai)`, `var(--mr-color-blue-info)`
   - Fonts: `var(--mr-font-family-sans)`, `var(--mr-font-family-mono)`
   - Shadows: `var(--mr-shadow-dialog)`, `var(--mr-shadow-card)`, `var(--mr-shadow-focus-ring)`
   - Button Heights: `var(--mr-button-height-sm)` (26px), `var(--mr-button-height-md)` (30px)

2. **Fallbacks in `var(...)`**:
   When specifying a fallback value inside `var(--mr-variable, fallback)`, make sure the fallback matches the exact value defined in `css-variables.css`.

3. **Node / Model Type Chips**:
   Use `--mr-type-<model_type>-text` and `--mr-type-<model_type>-rgb` for model type badges and glow highlights.
