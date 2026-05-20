import { JsonRpcPeer } from "@/remote/rpc";
import { Agent, BackendEvent, Chat, ChatIndexEntry, MessageAttachment, Project, ToolDetails } from "./types";

export class CrewApi {
  constructor(private readonly rpc: JsonRpcPeer) {}

  async listProjects(): Promise<Project[]> {
    const data = await this.rpc.call<{ items?: Project[] }>("projects.list");
    return data.items || [];
  }

  async listAgents(): Promise<Agent[]> {
    const data = await this.rpc.call<{ items?: Agent[] }>("agents.list");
    return data.items || [];
  }

  async listProjectChats(projectId: string, options: { limit?: number; offset?: number } = {}): Promise<ChatIndexEntry[]> {
    const data = await this.rpc.call<{ items?: ChatIndexEntry[] }>("projects.chats.list", {
      id: projectId,
      limit: options.limit,
      offset: options.offset
    });
    return data.items || [];
  }

  async createChat(projectId: string, title: string, mainAgentId: string): Promise<Chat> {
    return this.rpc.call<Chat>("chats.create", {
      project_id: projectId,
      title,
      main_agent_id: mainAgentId
    });
  }

  async getChat(id: string): Promise<Chat> {
    return this.rpc.call<Chat>("chats.get", { id });
  }

  async listEvents(chatId: string, after = 0, options: { compactTools?: boolean } = {}): Promise<BackendEvent[]> {
    const data = await this.rpc.call<{ events?: BackendEvent[] }>("chats.events.list", {
      chat_id: chatId,
      after,
      compact_tools: Boolean(options.compactTools)
    });
    return data.events || [];
  }

  async getToolDetails(chatId: string, toolCallSeq: number): Promise<ToolDetails> {
    return this.rpc.call<ToolDetails>("chats.tool.get", {
      chat_id: chatId,
      tool_call_seq: toolCallSeq
    });
  }

  async postMessage(chatId: string, content: string, targetAgentId: string, attachments: MessageAttachment[] = []): Promise<unknown> {
    return this.rpc.call("chats.messages.post", {
      id: chatId,
      content,
      target_agent_id: targetAgentId,
      attachments
    });
  }

  async interruptMessage(chatId: string, content: string, attachments: MessageAttachment[] = []): Promise<unknown> {
    return this.rpc.call("chats.messages.interrupt", {
      id: chatId,
      content,
      attachments
    });
  }

  async cancelPendingSteer(chatId: string, steerId: string): Promise<unknown> {
    return this.rpc.call("chats.messages.interrupt.cancel", { id: chatId, steer_id: steerId });
  }

  async deliverPendingSteers(chatId: string, steerIds: string[]): Promise<unknown> {
    return this.rpc.call("chats.messages.interrupt.deliver", { id: chatId, steer_ids: steerIds });
  }

  async cancelChat(chatId: string): Promise<unknown> {
    return this.rpc.call("chats.cancel", { id: chatId });
  }

  async deleteRemoteDevice(deviceId: string): Promise<unknown> {
    return this.rpc.call("remote.devices.delete", { device_id: deviceId });
  }

  subscribeChatEvents(
    chatId: string,
    after: number,
    options: { compactTools?: boolean },
    onEvent: (event: BackendEvent) => void,
    onDone: () => void,
    onError: (err: Error) => void
  ): () => void {
    let disposed = false;
    let subscriptionId = "";
    const cleanups = [
      this.rpc.on("chat.event", params => {
        const body = params as { subscription_id?: string; chat_id?: string; event?: BackendEvent };
        if (subscriptionId ? body.subscription_id !== subscriptionId : body.chat_id !== chatId) return;
        if (body.event) onEvent(body.event);
      }),
      this.rpc.on("chat.done", params => {
        const body = params as { subscription_id?: string; chat_id?: string };
        if (subscriptionId ? body.subscription_id !== subscriptionId : body.chat_id !== chatId) return;
        onDone();
      }),
      this.rpc.on("chat.error", params => {
        const body = params as { subscription_id?: string; chat_id?: string; message?: string };
        if (subscriptionId ? body.subscription_id !== subscriptionId : body.chat_id !== chatId) return;
        onError(new Error(body.message || "Chat stream failed"));
      })
    ];

    this.rpc.call<{ subscription_id: string }>("chats.events.subscribe", {
      chat_id: chatId,
      after,
      compact_tools: Boolean(options.compactTools)
    })
      .then(result => {
        subscriptionId = result.subscription_id;
        if (disposed && subscriptionId) {
          this.rpc.call("chats.events.unsubscribe", { subscription_id: subscriptionId }).catch(() => {});
        }
      })
      .catch(err => {
        if (!disposed) onError(err);
      });

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
      if (subscriptionId) {
        this.rpc.call("chats.events.unsubscribe", { subscription_id: subscriptionId }).catch(() => {});
      }
    };
  }
}
