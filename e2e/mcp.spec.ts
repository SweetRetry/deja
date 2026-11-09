import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { scratchVault } from "./helpers";

// The MCP endpoint as an agent reaches it: JSON-RPC over HTTP, against the real
// backend with a vault open. The e2e backend routes /mcp to the app's handler.
const MCP = "http://127.0.0.1:5177/mcp";
const vault = scratchVault("mcp");

let id = 0;
async function rpc(request: APIRequestContext, method: string, params: unknown = {}) {
  const response = await request.post(MCP, {
    data: { jsonrpc: "2.0", id: ++id, method, params },
    headers: { Accept: "application/json, text/event-stream" },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { result: any; error?: { code: number } };
}

const tool = async (request: APIRequestContext, name: string, args: unknown = {}) =>
  (await rpc(request, "tools/call", { name, arguments: args })).result;

async function openVault(request: APIRequestContext) {
  await request.post("http://127.0.0.1:5177/api/open_vault", { data: { path: vault.path, sort: "name" } });
  // Thumbnails come from indexing; get_asset hands one back.
  for (let i = 0; i < 20; i++) {
    const { data } = await (await request.post("http://127.0.0.1:5177/api/index_slice", { data: { batch: 12 } })).json();
    if (data.remaining === 0) break;
  }
}

test("an agent initializes, lists the tools, and a notification gets 202", async ({ request }) => {
  const init = await rpc(request, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  expect(init.result.protocolVersion).toBe("2025-06-18");
  expect(init.result.serverInfo.name).toBe("deja");
  const note = await request.post(MCP, { data: { jsonrpc: "2.0", method: "notifications/initialized" } });
  expect(note.status()).toBe(202);
  const { result } = await rpc(request, "tools/list");
  expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
    "vault_info",
    "search_assets",
    "get_asset",
    "find_similar",
    "update_asset",
  ]);
});

test("a foreign Origin and a GET are refused", async ({ request }) => {
  const foreign = await request.post(MCP, {
    data: { jsonrpc: "2.0", id: 1, method: "ping" },
    headers: { Origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);
  expect((await request.get(MCP)).status()).toBe(405);
});

test("search, look, find similar and tag a file of the open vault", async ({ request }) => {
  await openVault(request);

  const info = await tool(request, "vault_info");
  expect(info.isError).toBe(false);
  expect(info.structuredContent.files).toBe(12);
  expect(info.structuredContent.tags["深色"]).toBe(1);

  const byTag = await tool(request, "search_assets", { tag: "渐变" });
  expect(byTag.structuredContent.results.map((r: { path: string }) => r.path)).toEqual(["UI参考/登录页/渐变按钮-03.jpg"]);

  const byWord = await tool(request, "search_assets", { query: "深色登录" });
  const first = byWord.structuredContent.results[0];
  expect(first.path).toBe("UI参考/登录页/深色登录-dribbble.jpg");
  expect(first.absolutePath).toBe(join(realpathSync(vault.path), first.path));

  // An absolute path works too, and the thumbnail comes back as an image.
  const look = await tool(request, "get_asset", { path: first.absolutePath });
  expect(look.structuredContent.source).toBe("https://dribbble.com/shots/1234567");
  expect(look.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });

  const similar = await tool(request, "find_similar", { path: first.path, limit: 3 });
  expect(similar.structuredContent.results).toHaveLength(3);

  const updated = await tool(request, "update_asset", { path: first.path, addTags: ["收藏"], removeTags: ["参考"], rating: 5 });
  expect(updated.structuredContent).toMatchObject({ tags: ["深色", "登录", "收藏"], rating: 5 });
  const onDisk = readFileSync(join(vault.path, ".deja/meta", `${first.path}.md`), "utf8");
  expect(onDisk).toContain("rating: 5");
  expect(onDisk).toContain("收藏");

  const missing = await tool(request, "get_asset", { path: "nope.jpg" });
  expect(missing).toMatchObject({ isError: true, content: [{ text: "nope.jpg is not in the vault" }] });
});
