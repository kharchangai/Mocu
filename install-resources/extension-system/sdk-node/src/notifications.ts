import { HOST_METHODS } from "@mocu/extension-contracts";
import type { DesktopNotificationParams } from "@mocu/extension-contracts";
import type { JsonRpcProtocolClient } from "./protocol-client.js";

export class NotificationsApi {
  constructor(private readonly client: JsonRpcProtocolClient) {}

  /** Show a desktop notification; declare "notifications.show" in the extension manifest. */
  async show(params: DesktopNotificationParams): Promise<{ id: string }> {
    if (!params || typeof params !== "object") throw new Error("Notification settings must be an object.");
    return this.client.request<{ id: string }>(HOST_METHODS.notificationShow, params);
  }
}
