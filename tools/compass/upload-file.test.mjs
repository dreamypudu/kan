import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { uploadFile } from "./upload-file.mjs";

test("only uploads approved bytes and sends no Kan credentials", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "compass-upload-"));
  try {
    const file = path.join(dir, "acta.md");
    const body = "Acta COMPASS";
    await writeFile(file, body);
    const ticket = {
      url: "https://storage.example/file?signature=secret",
      key: "card/file",
      contentType: "text/markdown",
      size: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    let calls = 0;
    const put = async (_url, options) => {
      calls++;
      assert.equal(options.method, "PUT");
      assert.equal(options.body.toString(), body);
      assert.deepEqual(options.headers, { "Content-Type": "text/markdown" });
      assert.equal(options.redirect, "error");
      return { ok: true };
    };
    assert.deepEqual(await uploadFile(file, ticket, put), {
      key: ticket.key,
      size: ticket.size,
      sha256: ticket.sha256,
    });
    await writeFile(file, "Otro COMPASS");
    await assert.rejects(uploadFile(file, ticket, put), /content differs/);
    await assert.rejects(
      uploadFile(file, { ...ticket, url: "http://storage.example/file" }, put),
      /HTTPS/,
    );
    assert.equal(calls, 1);
  } finally {
    await unlink(path.join(dir, "acta.md"));
    await rmdir(dir);
  }
});
