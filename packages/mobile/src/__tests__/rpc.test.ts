import { describe, expect, it } from "vitest";
import { utf8 } from "../remote/bytes";
import { JsonRpcPeer, RpcError } from "../remote/rpc";

function makePeer() {
  const sent: string[] = [];
  const transport = {
    send(bytes: Uint8Array) {
      sent.push(new TextDecoder().decode(bytes));
    },
    async decrypt(data: Uint8Array) {
      return data;
    },
    close() {}
  };
  return { peer: new JsonRpcPeer(transport as any), sent };
}

describe("JsonRpcPeer", () => {
  it("resolves responses by id", async () => {
    const { peer, sent } = makePeer();
    const promise = peer.call("projects.list");
    const id = JSON.parse(sent[0]).id;
    await peer.handleFrame(utf8(JSON.stringify({ jsonrpc: "2.0", id, result: { items: [] } })));
    await expect(promise).resolves.toEqual({ items: [] });
  });

  it("rejects RPC errors", async () => {
    const { peer, sent } = makePeer();
    const promise = peer.call("projects.list");
    const id = JSON.parse(sent[0]).id;
    await peer.handleFrame(utf8(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "bad" } })));
    await expect(promise).rejects.toBeInstanceOf(RpcError);
  });

  it("dispatches notifications and removes listeners", async () => {
    const { peer } = makePeer();
    const calls: unknown[] = [];
    const cleanup = peer.on("chat.event", params => calls.push(params));
    await peer.handleFrame(utf8(JSON.stringify({ jsonrpc: "2.0", method: "chat.event", params: { ok: true } })));
    cleanup();
    await peer.handleFrame(utf8(JSON.stringify({ jsonrpc: "2.0", method: "chat.event", params: { ok: false } })));
    expect(calls).toEqual([{ ok: true }]);
  });
});
