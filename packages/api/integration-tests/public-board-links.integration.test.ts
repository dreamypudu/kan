import { beforeAll, describe, expect, it } from "vitest";

import { boards } from "@kan/db/schema";
import { generateSlug } from "@kan/shared/utils";

import type { TestDbClient } from "./test-db";
import { boardRouter } from "../src/routers/board";
import { createTestDb, seedTestData } from "./test-db";

describe("shared board access without a session", () => {
  let db: TestDbClient;

  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);

  it("reads public slugs anonymously but hides private and deleted boards", async () => {
    const rollback = new Error("Rollback public link fixtures");
    await expect(
      db.transaction(async (tx) => {
        const { workspace, user } = await seedTestData(
          tx as unknown as TestDbClient,
        );
        const slug = generateSlug("COMPASS tareas semanales");
        await tx.insert(boards).values([
          {
            publicId: "public123456",
            name: "Public board",
            slug,
            visibility: "public",
            workspaceId: workspace.id,
            createdBy: user.id,
          },
          {
            publicId: "private12345",
            name: "Private board",
            slug: "private-board",
            visibility: "private",
            workspaceId: workspace.id,
            createdBy: user.id,
          },
          {
            publicId: "deleted12345",
            name: "Deleted board",
            slug: "deleted-board",
            visibility: "public",
            deletedAt: new Date(),
            workspaceId: workspace.id,
            createdBy: user.id,
          },
        ]);
        const caller = boardRouter.createCaller({
          db: tx,
          user: null,
          headers: new Headers(),
        } as never);
        const result = await caller.bySlug({
          workspaceSlug: workspace.slug,
          boardSlug: slug,
        });
        expect(result?.publicId).toBe("public123456");
        expect(result?.slug).toBe(slug);
        expect(
          await caller.bySlug({
            workspaceSlug: workspace.slug,
            boardSlug: "private-board",
          }),
        ).toBeNull();
        expect(
          await caller.bySlug({
            workspaceSlug: workspace.slug,
            boardSlug: "deleted-board",
          }),
        ).toBeNull();
        await expect(
          caller.byId({ boardPublicId: "private12345" }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }, 30_000);
});
