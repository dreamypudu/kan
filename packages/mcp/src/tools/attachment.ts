import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { KanClient } from "../client.js";

export function registerAttachmentTools(
  server: McpServer,
  client: KanClient,
): void {
  server.tool(
    "prepare_card_attachment_upload",
    "Request a temporary S3 upload URL for a card attachment. Upload the file with HTTP PUT before calling confirm_card_attachment_upload. Never include the Kan API token in the PUT request.",
    {
      cardPublicId: z.string().length(12),
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1),
      size: z
        .number()
        .int()
        .positive()
        .max(50 * 1024 * 1024),
    },
    async ({ cardPublicId, filename, contentType, size }) => {
      const data = await client.request(
        "POST",
        `/cards/${cardPublicId}/attachments/upload-url`,
        { filename, contentType, size },
      );
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );

  server.tool(
    "confirm_card_attachment_upload",
    "Register a successfully uploaded attachment on a card. Use the S3 key returned by prepare_card_attachment_upload. Do not retry blindly after an uncertain response; check get_card attachments first.",
    {
      cardPublicId: z.string().length(12),
      s3Key: z.string().min(1),
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1),
      size: z
        .number()
        .int()
        .positive()
        .max(50 * 1024 * 1024),
    },
    async ({ cardPublicId, s3Key, filename, contentType, size }) => {
      const data = await client.request(
        "POST",
        `/cards/${cardPublicId}/attachments/confirm`,
        { s3Key, filename, originalFilename: filename, contentType, size },
      );
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );
}
