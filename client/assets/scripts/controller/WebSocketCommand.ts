/**
 * WebSocket Command - обработка WebSocket соединения
 */

import { SimpleCommand } from "../core/PureMVC";
import { Notification } from "../core/PureMVC";
import { ProxyNames } from "../constants/ProxyNames";
import { Notifications } from "../constants/Notifications";
import { WebSocketProxy } from "../model/proxy/WebSocketProxy";

export class WebSocketConnectCommand extends SimpleCommand {
  execute(notification: Notification): void {
    const wsProxy = this.facade?.retrieveProxy(ProxyNames.WEBSOCKET_PROXY) as WebSocketProxy;
    if (!wsProxy) return;

    const { roomId, wsUrl } = notification.body || {};
    if (roomId && wsUrl) {
      wsProxy.connect(roomId, wsUrl);
    }
  }
}
