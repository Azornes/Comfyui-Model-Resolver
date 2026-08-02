# Model Resolver - CSS Architecture & Design Tokens

This directory contains the core stylesheets and token system for the `comfyui-model-resolver` extension.

## Stylesheet Structure

- **`css-variables.css`**: Central design system token registry (`:root`). Structured into 5 clear sections:
  1. *Base Palette & Overlays* (grayscale, primary colors, dark/light overlays)
  2. *Typography, Spacing, Transitions & Z-Index* (font families, spacing scale, radii, transitions, z-index hierarchy)
  3. *Theme Semantic Colors & Surfaces* (main background shades, card/panel backgrounds, text hierarchy, action colors)
  4. *Model & Node Type Badges* (RGB/text tokens for model types: LoRA, VAE, CLIP, ControlNet, etc.)
  5. *Component Tokens, Badges, Shadows & Layout Dimensions* (buttons, inputs, status badges, shadows, gradients, scrollbars, and drawer widths)
- **`resolver-main.css`**: Styles for the main dialog, missing models browser, tab contents, lists, search tables, and model details views.
- **`resolver-shell.css`**: Styles for the outer modal shell, sidebar docking panel, window controls, and queue drawer.
- **`missing-type-filter.css`**: Styles for the Missing Models type filter control and menu.

## Usage Guidelines

1. **Always Use CSS Variables**:
   Avoid using raw hex colors (e.g. `#111111`, `#4caf50`) or hardcoded pixel values when a variable exists.
   - **Backgrounds & Surfaces**: `var(--mr-bg)`, `var(--mr-bg-soft)`, `var(--mr-card-bg)`, `var(--mr-panel-bg)`
   - **Text Colors**: `var(--mr-text)`, `var(--mr-text-muted)`, `var(--mr-text-dim)`, `var(--mr-text-soft)`
   - **Accent & Status**: `var(--mr-accent)`, `var(--mr-warning)`, `var(--mr-color-civitai)`, `var(--mr-color-blue-info)`, `var(--mr-color-success-action)`
   - **Typography**: `var(--mr-font-family-sans)`, `var(--mr-font-family-mono)`
   - **Shadows**: `var(--mr-shadow-dialog)`, `var(--mr-shadow-card)`, `var(--mr-shadow-floating)`, `var(--mr-shadow-focus-ring)`
   - **Button & Layout Dimensions**: `var(--mr-button-height-sm)` (26px), `var(--mr-button-height-md)` (30px), `var(--mr-missing-row-height)` (70px), `var(--mr-queue-drawer-width)` (320px), `var(--mr-splitter-width)` (10px)

2. **Standardized Transitions**:
   Use smooth transition tokens instead of inline timing strings:
   - Multi-property smooth: `var(--mr-transition-smooth)`
   - Popovers & Modals: `var(--mr-transition-popover)`
   - Transforms: `var(--mr-transition-transform)`
   - Width changes: `var(--mr-transition-width)`
   - Form Controls: `var(--mr-missing-control-transition)`

3. **Fallbacks in `var(...)`**:
   When specifying a fallback value inside `var(--mr-variable, fallback)`, ensure the fallback matches the exact value defined in `css-variables.css`.

4. **Node / Model Type Chips**:
   Use `--mr-type-<model_type>-text` and `--mr-type-<model_type>-rgb` for model type badges, borders, and glow highlights.
