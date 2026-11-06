import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";

export interface ToolRegistrar {
  tool<T extends ZodRawShape>(
    name: string,
    description: string,
    params: T,
    callback: ToolCallback<T>,
  ): void;
}
