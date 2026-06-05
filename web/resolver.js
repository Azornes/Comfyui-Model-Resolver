/**
 * ComfyUI Model Resolver Extension - Frontend
 *
 * Provides a menu button and dialog interface for relinking missing models in workflows.
 */

import { app } from "../../../scripts/app.js";
import { ModelResolver as ModelResolverClass } from "./resolver/model_resolver.js";
import { registerGlobalHelpers } from "./resolver/globals.js";

registerGlobalHelpers();

const modelResolver = new ModelResolverClass();

app.registerExtension({
    name: "Model Resolver",
    setup: modelResolver.setup
});
