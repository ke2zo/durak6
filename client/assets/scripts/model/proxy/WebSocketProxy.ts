/**
 * WebSocket Proxy - управление WebSocket соединением
 */

import { Proxy } from "../../core/PureMVC";
import { ProxyNames } from "../../constants/ProxyNames";
import { Notifications } from "../../constants/Notifications";
import { ClientMessage, ServerMessage } from "../../types/GameTypes";

export class WebSocketProxy extends Proxy {
  public static NAME = ProxyNames.WEBSOCKET_PROXY;

  private ws: WebSocket | null = null;
  private roomId: string = "";
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;

  constructor() {
    super(WebSocketProxy.NAME);
  }

  connect(roomId: string, wsUrl: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.warn("WebSocket already connected");
      return;
    }

    this.roomId = roomId;
    this.reconnectAttempts = 0;

    try {
      // Преобразуем относительный URL в абсолютный
      const url = wsUrl.startsWith("ws://") || wsUrl.startsWith("wss://")
        ? wsUrl
        : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${wsUrl}`;

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.sendNotification(Notifications.WS_CONNECTED, { roomId });
        this.join();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: ServerMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        this.sendNotification(Notifications.WS_ERROR, { error });
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        this.sendNotification(Notifications.WS_DISCONNECTED, {
          code: event.code,
          reason: event.reason,
        });

        // Попытка переподключения
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => {
            this.connect(roomId, wsUrl);
          }, this.reconnectDelay * this.reconnectAttempts);
        }
      };
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
      this.sendNotification(Notifications.WS_ERROR, { error });
    }
  }

  private join(): void {
    const authProxy = this.facade?.retrieveProxy(ProxyNames.AUTH_PROXY) as any;
    if (!authProxy || !authProxy.isAuthenticated()) {
      console.error("Cannot join: not authenticated");
      return;
    }

    const message: ClientMessage = {
      type: "JOIN",
      sessionToken: authProxy.getSessionToken(),
    };

    this.send(message);
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case "STATE":
        if (message.state) {
          const gameProxy = this.facade?.retrieveProxy(ProxyNames.GAME_PROXY) as any;
          if (gameProxy) {
            gameProxy.setGameState(message.state);
          }
        }
        break;

      case "INFO":
        this.sendNotification(Notifications.SHOW_MESSAGE, {
          message: message.message,
          type: "info",
        });
        break;

      case "ERROR":
        this.sendNotification(Notifications.SHOW_MESSAGE, {
          message: message.detail || message.code || "Error",
          type: "error",
        });
        break;
    }
  }

  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not connected, cannot send message");
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error("Failed to send WebSocket message:", error);
    }
  }

  attack(card: string): void {
    this.send({ type: "ATTACK", card });
  }

  defend(attackIndex: number, card: string): void {
    this.send({ type: "DEFEND", attackIndex, card });
  }

  transfer(card: string): void {
    this.send({ type: "TRANSFER", card });
  }

  take(): void {
    this.send({ type: "TAKE" });
  }

  beat(): void {
    this.send({ type: "BEAT" });
  }

  pass(): void {
    this.send({ type: "PASS" });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.roomId = "";
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  getRoomId(): string {
    return this.roomId;
  }
}
