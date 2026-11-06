import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { KanClient } from "./client.js";
import type { ToolRegistrar } from "./tools/registrar.js";
import { registerAttachmentTools } from "./tools/attachment.js";
import { registerBoardTools } from "./tools/board.js";
import { registerCardTools } from "./tools/card.js";
import { registerChecklistTools } from "./tools/checklist.js";
import { registerLabelTools } from "./tools/label.js";
import { registerListTools } from "./tools/list.js";
import { registerMemberTools } from "./tools/member.js";
import { registerWorkspaceTools } from "./tools/workspace.js";

export function createKanMcpServer(
  client: KanClient,
  options?: {
    allowedTools?: ReadonlySet<string>;
    instructions?: string;
  },
): McpServer {
  const server = new McpServer(
    {
      name: "kan",
      version: "0.1.0",
    },
    { instructions: options?.instructions },
  );

  const registry: ToolRegistrar = {
    tool(name, description, params, callback) {
      if (options?.allowedTools && !options.allowedTools.has(name)) return;
      server.tool(
        name,
        description,
        params,
        {
          readOnlyHint: /^(get_|list_|find_|search_|check_)/.test(name),
          destructiveHint: !/^(get_|list_|find_|search_|check_)/.test(name),
          openWorldHint: false,
        },
        callback,
      );
    },
  };

  registerWorkspaceTools(registry, client);
  registerBoardTools(registry, client);
  registerListTools(registry, client);
  registerCardTools(registry, client);
  registerChecklistTools(registry, client);
  registerLabelTools(registry, client);
  registerMemberTools(registry, client);
  registerAttachmentTools(registry, client);

  return server;
}
