/**
 * Startup Command - инициализация приложения
 */

import { SimpleCommand } from "../core/PureMVC";
import { Notification } from "../core/PureMVC";
import { Notifications } from "../constants/Notifications";
import { ProxyNames } from "../constants/ProxyNames";
import { AuthProxy } from "../model/proxy/AuthProxy";
import { GameProxy } from "../model/proxy/GameProxy";
import { WebSocketProxy } from "../model/proxy/WebSocketProxy";

export class StartupCommand extends SimpleCommand {
  execute(notification: Notification): void {
    // Регистрируем прокси
    this.facade?.registerProxy(new AuthProxy());
    this.facade?.registerProxy(new GameProxy());
    this.facade?.registerProxy(new WebSocketProxy());

    // Устанавливаем API URL из конфига или окружения
    const apiBaseUrl = (window as any).API_BASE_URL || "";
    const authProxy = this.facade?.retrieveProxy(ProxyNames.AUTH_PROXY) as AuthProxy;
    const gameProxy = this.facade?.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;
    
    if (authProxy) authProxy.setApiBaseUrl(apiBaseUrl);
    if (gameProxy) gameProxy.setApiBaseUrl(apiBaseUrl);

    console.log("Application started");
  }
}
