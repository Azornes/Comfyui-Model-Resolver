/**
 * ComfyUI Model Resolver Extension - Frontend
 *
 * Provides a menu button and dialog interface for relinking missing models in workflows.
 */

import { app } from "../../../scripts/app.js";
import {
    MODEL_RESOLVER_OPEN_COMMAND_ID,
    MODEL_RESOLVER_OPEN_DEFAULT_KEYBINDING,
    ModelResolver as ModelResolverClass,
} from "./resolver/model_resolver.js";
import { registerGlobalHelpers } from "./resolver/globals.js";

registerGlobalHelpers();

const modelResolver = new ModelResolverClass();

app.registerExtension({
    name: "Model Resolver",
    commands: [
        {
            id: MODEL_RESOLVER_OPEN_COMMAND_ID,
            label: "Open Model Resolver",
            function: () => modelResolver.openResolverManager(),
        },
    ],
    keybindings: [
        MODEL_RESOLVER_OPEN_DEFAULT_KEYBINDING,
    ],
    setup: modelResolver.setup
});
