import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KanClient } from "./client.js";
import { createKanMcpServer } from "./server.js";

describe("createKanMcpServer over Streamable HTTP", () => {
  let httpServer: ReturnType<typeof createServer>;
  let baseUrl: URL;
  const request = vi.fn();
  const client: KanClient = { request };

  beforeEach(async () => {
    request.mockReset();

    httpServer = createServer((req, res) => {
      const mcpServer = createKanMcpServer(client);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });
      void mcpServer
        .connect(transport)
        .then(() => transport.handleRequest(req, res));
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("lists tools and forwards a tool call through to the injected client", async () => {
    request.mockResolvedValueOnce([
      { publicId: "board-123456", name: "Roadmap" },
    ]);

    const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
    const clientTransport = new StreamableHTTPClientTransport(baseUrl);
    await mcpClient.connect(clientTransport);

    const { tools } = await mcpClient.listTools();
    expect(tools.map((t) => t.name)).toContain("list_boards");
    expect(tools.map((t) => t.name)).toContain(
      "prepare_card_attachment_upload",
    );
    expect(tools.map((t) => t.name)).toContain(
      "confirm_card_attachment_upload",
    );

    const result = await mcpClient.callTool({
      name: "list_boards",
      arguments: { workspacePublicId: "workspace-123456" },
    });

    expect(request).toHaveBeenCalledWith(
      "GET",
      "/workspaces/workspace-123456/boards",
    );
    const [content] = result.content as { type: string; text: string }[];
    expect(content?.text).toContain("Roadmap");

    await mcpClient.close();
  });
});

describe("restricted remote tool registration", () => {
  it("advertises only permitted tools and rejects an unregistered destructive operation", async () => {
    const request = vi.fn().mockResolvedValue({ publicId: "card12345678" });
    const server = createKanMcpServer(
      { request },
      {
        allowedTools: new Set(["get_card", "create_checklist_item"]),
        instructions: "Ask for approval before changes",
      },
    );
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_checklist_item",
      "get_card",
    ]);
    expect(
      tools.find((tool) => tool.name === "get_card")?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((tool) => tool.name === "create_checklist_item")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
    const result = await client.callTool({
      name: "delete_card",
      arguments: { cardPublicId: "card12345678" },
    });
    expect(result.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
    await client.close();
    await server.close();
  });
});
