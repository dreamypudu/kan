import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-runtime-env", () => ({
  env: vi.fn(),
}));
vi.mock("@kan/db/client", () => ({ createDrizzleClient: vi.fn(() => ({})) }));
vi.mock("@kan/auth/mcp-oauth", () => ({
  MCP_SCOPE: "kan:mcp",
  getMcpOAuthUrls: () => ({ base: "https://kan.bn" }),
  verifyMcpAccessToken: vi.fn(),
}));

vi.mock("@kan/api/trpc-context", () => ({
  createNextApiContext: vi
    .fn()
    .mockRejectedValue(new Error("no auth in tests")),
}));
vi.mock("@kan/logger", () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
}));

const request = vi.fn();
vi.mock("@kan.bn/mcp/client", () => ({
  createKanClient: vi.fn(() => ({ request })),
  KanApiError: class KanApiError extends Error {
    constructor(
      public status: number,
      public statusText: string,
      public body: unknown,
    ) {
      super("Kan API error");
    }
  },
}));

const connect = vi.fn().mockResolvedValue(undefined);
const close = vi.fn().mockResolvedValue(undefined);
vi.mock("@kan.bn/mcp", () => ({
  createKanMcpServer: vi.fn(() => ({ connect, close })),
}));

const handleRequest = vi.fn().mockResolvedValue(undefined);
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn(() => ({
    close: vi.fn().mockResolvedValue(undefined),
    handleRequest,
  })),
}));

const { env } = await import("next-runtime-env");
const mockedEnv = vi.mocked(env);
const { createKanClient } = await import("@kan.bn/mcp/client");
const mockedCreateKanClient = vi.mocked(createKanClient);
const { clearPaidWorkspaceCache } = await import(
  "@kan/api/utils/paidWorkspaceCache"
);
const handler = (await import("../pages/api/mcp.js")).default;

function makeReqRes(headers: Record<string, string> = {}) {
  const req = {
    method: "POST",
    headers: { authorization: "Bearer kan_test_token", ...headers },
  } as unknown as NextApiRequest;
  const statusSpy = vi.fn().mockReturnThis();
  const setHeaderSpy = vi.fn();
  const res = {
    setHeader: setHeaderSpy,
    status: statusSpy,
    json: vi.fn(),
    on: vi.fn(),
  } as unknown as NextApiResponse;
  return { req, res, statusSpy, setHeaderSpy };
}

describe("POST /api/mcp", () => {
  beforeEach(() => {
    request.mockReset();
    connect.mockClear();
    handleRequest.mockClear();
    mockedCreateKanClient.mockClear();
    mockedEnv.mockReset();
    mockedEnv.mockImplementation((key: string) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "https://kan.bn";
      return undefined;
    });
    clearPaidWorkspaceCache();
  });

  it("rejects an expired OAuth token before connecting a tool server", async () => {
    const { verifyMcpAccessToken } = await import("@kan/auth/mcp-oauth");
    vi.mocked(verifyMcpAccessToken).mockResolvedValue(null);
    const { req, res, statusSpy, setHeaderSpy } = makeReqRes({
      authorization: "Bearer kan_mcp_access_expired",
    });
    await handler(req, res);
    expect(statusSpy).toHaveBeenCalledWith(401);
    expect(setHeaderSpy).toHaveBeenCalledWith(
      "WWW-Authenticate",
      expect.stringContaining("resource_metadata="),
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it("serves the restricted tool set for an authorized OAuth user", async () => {
    const { verifyMcpAccessToken } = await import("@kan/auth/mcp-oauth");
    const { createKanMcpServer } = await import("@kan.bn/mcp");
    vi.mocked(verifyMcpAccessToken).mockResolvedValue({
      user: { id: "test" },
    } as never);
    const { req, res } = makeReqRes({
      authorization: "Bearer kan_mcp_access_valid",
    });
    await handler(req, res);
    const options = vi.mocked(createKanMcpServer).mock.calls.at(-1)?.[1];
    expect(options?.allowedTools?.has("create_checklist_item")).toBe(true);
    expect(options?.allowedTools?.has("delete_card")).toBe(true);
    expect(options?.allowedTools?.has("delete_list")).toBe(true);
    expect(options?.allowedTools?.has("update_list")).toBe(true);
    expect(options?.allowedTools?.has("delete_workspace")).toBe(false);
    expect(options?.allowedTools?.has("invite_member")).toBe(false);
    expect(connect).toHaveBeenCalled();
  });

  it("rejects a free-plan-only workspace on Kan Cloud with 403", async () => {
    mockedEnv.mockImplementation((key: string) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "https://kan.bn";
      if (key === "NEXT_PUBLIC_KAN_ENV") return "cloud";
      return undefined;
    });
    request.mockResolvedValueOnce([{ workspace: { plan: "free" } }]);

    const { req, res, statusSpy } = makeReqRes();
    await handler(req, res);

    expect(statusSpy).toHaveBeenCalledWith(403);
    expect(connect).not.toHaveBeenCalled();
  });

  it("allows a team-plan workspace on Kan Cloud through", async () => {
    mockedEnv.mockImplementation((key: string) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "https://kan.bn";
      if (key === "NEXT_PUBLIC_KAN_ENV") return "cloud";
      return undefined;
    });
    request.mockResolvedValueOnce([
      { workspace: { plan: "free" } },
      { workspace: { plan: "team" } },
    ]);

    const { req, res, statusSpy } = makeReqRes();
    await handler(req, res);

    expect(statusSpy).not.toHaveBeenCalledWith(403);
    expect(connect).toHaveBeenCalled();
  });

  it("does not gate self-hosted instances even on the free plan", async () => {
    mockedEnv.mockImplementation((key: string) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "https://kan.example.com";
      if (key === "NEXT_PUBLIC_KAN_ENV") return "self-hosted";
      return undefined;
    });

    const { req, res, statusSpy } = makeReqRes();
    await handler(req, res);

    expect(request).not.toHaveBeenCalled();
    expect(statusSpy).not.toHaveBeenCalledWith(403);
    expect(connect).toHaveBeenCalled();
  });

  it("strips a trailing slash from NEXT_PUBLIC_BASE_URL", async () => {
    mockedEnv.mockImplementation((key: string) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "https://kan.bn/";
      return undefined;
    });

    const { req, res } = makeReqRes();
    await handler(req, res);

    expect(mockedCreateKanClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://kan.bn" }),
    );
  });

  it('accepts a lowercase "bearer" auth scheme', async () => {
    const { req, res, statusSpy } = makeReqRes({
      authorization: "bearer kan_test_token",
    });
    await handler(req, res);

    expect(statusSpy).not.toHaveBeenCalledWith(401);
    expect(mockedCreateKanClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: "kan_test_token" }),
    );
  });

  it("returns a clean 500 instead of throwing when the plan check fails unexpectedly", async () => {
    mockedEnv.mockImplementation((key: string) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "https://kan.bn";
      if (key === "NEXT_PUBLIC_KAN_ENV") return "cloud";
      return undefined;
    });
    request.mockRejectedValueOnce(new TypeError("fetch failed"));

    const { req, res, statusSpy } = makeReqRes();
    await expect(handler(req, res)).resolves.not.toThrow();

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(connect).not.toHaveBeenCalled();
  });

  it("skips the redundant plan check on a second call with the same token", async () => {
    mockedEnv.mockImplementation((key: string) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "https://kan.bn";
      if (key === "NEXT_PUBLIC_KAN_ENV") return "cloud";
      return undefined;
    });
    request.mockResolvedValueOnce([{ workspace: { plan: "team" } }]);

    const first = makeReqRes();
    await handler(first.req, first.res);
    expect(request).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);

    const second = makeReqRes();
    await handler(second.req, second.res);

    expect(request).toHaveBeenCalledTimes(1);
    expect(second.statusSpy).not.toHaveBeenCalledWith(403);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("returns a real 429 instead of a generic 500 when the plan check is rate limited", async () => {
    mockedEnv.mockImplementation((key: string) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "https://kan.bn";
      if (key === "NEXT_PUBLIC_KAN_ENV") return "cloud";
      return undefined;
    });
    const { KanApiError } = await import("@kan.bn/mcp/client");
    request.mockRejectedValueOnce(
      new KanApiError(429, "Too Many Requests", {
        message: "Too many requests, please try again later.",
      }),
    );

    const { req, res, statusSpy } = makeReqRes();
    await expect(handler(req, res)).resolves.not.toThrow();

    expect(statusSpy).toHaveBeenCalledWith(429);
    expect(statusSpy).not.toHaveBeenCalledWith(500);
    expect(connect).not.toHaveBeenCalled();
  });
});
