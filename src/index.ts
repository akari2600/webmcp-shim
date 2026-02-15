export { ModelContext } from "./shim.js";
export type {
  ModelContextTool,
  ModelContextClient,
  ProvideContextOptions,
  AnthropicToolDef,
} from "./shim.js";

import { ModelContext } from "./shim.js";

declare global {
  interface Navigator {
    modelContext: ModelContext;
  }
}

if (typeof navigator !== "undefined" && !navigator.modelContext) {
  navigator.modelContext = new ModelContext();
}
