import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// A local helper, deliberately not an MCP tool: remote MCP clients cannot read host files.
export async function uploadFile(filePath, ticket, put = fetch) {
  const url = new URL(ticket.url);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Expected the HTTPS upload URL returned by Kan");
  }
  if (!ticket.key || !ticket.contentType || !Number.isInteger(ticket.size)) {
    throw new Error("Upload ticket requires key, contentType and size");
  }
  const info = await stat(filePath);
  if (
    !info.isFile() ||
    info.size !== ticket.size ||
    info.size > 50 * 1024 * 1024
  ) {
    throw new Error(
      "Expected a regular file matching the approved size (maximum 50 MB)",
    );
  }
  const data = await readFile(filePath);
  if (
    !data.length ||
    data.length !== ticket.size ||
    data.length > 50 * 1024 * 1024
  ) {
    throw new Error(
      "File size differs from the approved upload or exceeds 50 MB",
    );
  }
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (ticket.sha256 !== sha256) {
    throw new Error("File content differs from the approved document");
  }
  const response = await put(url.href, {
    method: "PUT",
    headers: { "Content-Type": ticket.contentType },
    body: data,
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`Attachment upload failed (HTTP ${response.status})`);
  return { key: ticket.key, size: data.length, sha256 };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [filePath, ticketPath] = process.argv.slice(2);
    if (!filePath || !ticketPath)
      throw new Error(
        "Usage: node tools/compass/upload-file.mjs FILE PRIVATE_TICKET_JSON",
      );
    const ticket = JSON.parse(await readFile(ticketPath, "utf8"));
    const result = await uploadFile(filePath, ticket);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    // Signed URLs and parser errors can contain temporary credentials.
    process.stderr.write(
      "Upload failed; check the private ticket and reconcile with Kan before retrying.\n",
    );
    process.exitCode = 1;
  }
}
