/**
 * ComfyUI Model Resolver Extension - Frontend
 *
 * Provides a menu button and dialog interface for relinking missing models in workflows.
 */

import { app } from "../../../scripts/app.js";
import { ModelResolver } from "./resolver/model_resolver.js";
import { registerGlobalHelpers } from "./resolver/globals.js";

registerGlobalHelpers();

const ModelResolver = new ModelResolver();

app.registerExtension({
    name: "Model Resolver",
    setup: ModelResolver.setup
});
