// ---- Spec-aligned types ----

export interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, client: ModelContextClient) => unknown | Promise<unknown>;
}

export interface ModelContextClient {
  requestUserInteraction: (callback: () => void) => void;
}

export interface ProvideContextOptions {
  tools?: ModelContextTool[];
}

// ---- Consumer-side types (non-spec, for chat client) ----

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ChangeListener = () => void;

// ---- Implementation ----

const client: ModelContextClient = {
  requestUserInteraction(callback) {
    // In a real browser this would gate on a user gesture.
    // The shim just invokes the callback directly.
    callback();
  },
};

export class ModelContext {
  private tools = new Map<string, ModelContextTool>();
  private listeners = new Set<ChangeListener>();

  // ---- Spec surface ----

  provideContext(options?: ProvideContextOptions): void {
    this.tools.clear();
    if (options?.tools) {
      for (const tool of options.tools) {
        this.validateTool(tool);
        this.tools.set(tool.name, tool);
      }
    }
    this.notify();
  }

  clearContext(): void {
    this.tools.clear();
    this.notify();
  }

  registerTool(tool: ModelContextTool): void {
    this.validateTool(tool);
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    this.notify();
  }

  unregisterTool(name: string): void {
    this.tools.delete(name);
    this.notify();
  }

  // ---- Consumer API (non-spec, for chat client) ----

  getTools(): AnthropicToolDef[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  async executeTool(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered`);
    }
    return tool.execute(input, client);
  }

  addEventListener(_type: "change", fn: ChangeListener): void {
    this.listeners.add(fn);
  }

  removeEventListener(_type: "change", fn: ChangeListener): void {
    this.listeners.delete(fn);
  }

  // ---- Internal ----

  private validateTool(tool: ModelContextTool): void {
    if (!tool.name) throw new Error("Tool must have a name");
    if (!tool.description) throw new Error("Tool must have a description");
    if (!tool.inputSchema) throw new Error("Tool must have an inputSchema");
    if (typeof tool.execute !== "function")
      throw new Error("Tool must have an execute function");
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // listener errors must not break the shim
      }
    }
  }
}
