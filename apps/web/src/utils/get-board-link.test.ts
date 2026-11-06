import { describe, expect, it } from "vitest";

import { getBoardLink } from "./get-board-link";

const board = {
  boardPublicId: "7fgpc5945rqo",
  isTemplate: false,
  workspaceSlug: "fao0cnm69nxr",
  boardSlug: "compass-tareas-semanales",
};

describe("copied board links", () => {
  it("uses the public catch-all route and stored slugs for public boards", () => {
    expect(getBoardLink({ ...board, visibility: "public" })).toBe(
      "/fao0cnm69nxr/compass-tareas-semanales",
    );
  });

  it("supports imported boards whose slug is their public ID", () => {
    expect(
      getBoardLink({
        ...board,
        visibility: "public",
        boardSlug: board.boardPublicId,
      }),
    ).toBe("/fao0cnm69nxr/7fgpc5945rqo");
  });

  it("keeps private boards on the authenticated route", () => {
    expect(getBoardLink({ ...board, visibility: "private" })).toBe(
      "/boards/7fgpc5945rqo",
    );
  });

  it("preserves template links even when visibility is public", () => {
    expect(
      getBoardLink({ ...board, isTemplate: true, visibility: "public" }),
    ).toBe("/templates/7fgpc5945rqo");
  });

  it("does not generate a malformed public path while slugs are unavailable", () => {
    expect(
      getBoardLink({
        ...board,
        visibility: "public",
        workspaceSlug: undefined,
      }),
    ).toBe("/boards/7fgpc5945rqo");
  });
});
