/**
 * Auth Proxy - управление аутентификацией
 */

import { Proxy } from "../../core/PureMVC";
import { ProxyNames } from "../../constants/ProxyNames";
import { Notifications } from "../../constants/Notifications";
import { AuthResponse } from "../../types/GameTypes";

export class AuthProxy extends Proxy {
  public static NAME = ProxyNames.AUTH_PROXY;

  private sessionToken: string = "";
  private user: any = null;
  private apiBaseUrl: string = "";

  constructor() {
    super(AuthProxy.NAME);
    // В Cocos Creator можно получить URL из конфига или переменных окружения
    this.apiBaseUrl = (window as any).API_BASE_URL || "";
  }

  setApiBaseUrl(url: string): void {
    this.apiBaseUrl = url;
  }

  getSessionToken(): string {
    return this.sessionToken;
  }

  getUser(): any {
    return this.user;
  }

  async authenticate(initData: string): Promise<void> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/auth/telegram`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ initData }),
      });

      const data: AuthResponse = await response.json();

      if (data.ok && data.sessionToken) {
        this.sessionToken = data.sessionToken;
        this.user = data.user;
        this.sendNotification(Notifications.AUTH_SUCCESS, {
          sessionToken: this.sessionToken,
          user: this.user,
        });
      } else {
        this.sendNotification(Notifications.AUTH_FAILED, {
          error: data.error || "Authentication failed",
        });
      }
    } catch (error: any) {
      this.sendNotification(Notifications.AUTH_FAILED, {
        error: error.message || "Network error",
      });
    }
  }

  async authenticateWithTelegram(): Promise<void> {
    // Получаем initData из Telegram WebApp
    const initData = (window as any).Telegram?.WebApp?.initData || "";
    if (!initData) {
      this.sendNotification(Notifications.AUTH_FAILED, {
        error: "Telegram WebApp not available",
      });
      return;
    }
    await this.authenticate(initData);
  }

  isAuthenticated(): boolean {
    return !!this.sessionToken;
  }

  clear(): void {
    this.sessionToken = "";
    this.user = null;
  }
}
