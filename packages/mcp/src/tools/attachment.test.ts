import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { registerAttachmentTools } from "./attachment.js";

describe("attachment upload tools", () => {
  it("uses the existing upload API and preserves the original filename at confirmation", async () => {
    const tools = new Map<string, (...args: unknown[]) => unknown>();
    const server = {
      tool: (name: string, ...args: unknown[]) => {
        tools.set(name, args.at(-1) as (...args: unknown[]) => unknown);
      },
    } as unknown as McpServer;
    const request = vi.fn().mockResolvedValue({ key: "workspace/card/file" });
    registerAttachmentTools(server, { request });
    const file = {
      cardPublicId: "card12345678",
      filename: "Acta COMPASS.pdf",
      contentType: "application/pdf",
      size: 1024,
    };

    await tools.get("prepare_card_attachment_upload")?.(file);
    expect(request).toHaveBeenNthCalledWith(
      1,
      "POST",
      "/cards/card12345678/attachments/upload-url",
      {
        filename: file.filename,
        contentType: file.contentType,
        size: file.size,
      },
    );
    await tools.get("confirm_card_attachment_upload")?.({
      ...file,
      s3Key: "workspace/card/file",
    });
    expect(request).toHaveBeenNthCalledWith(
      2,
      "POST",
      "/cards/card12345678/attachments/confirm",
      {
        s3Key: "workspace/card/file",
        filename: file.filename,
        originalFilename: file.filename,
        contentType: file.contentType,
        size: file.size,
      },
    );
  });
});
