/**
 * Auth Command - обработка аутентификации
 */

import { SimpleCommand } from "../core/PureMVC";
import { Notification } from "../core/PureMVC";
import { ProxyNames } from "../constants/ProxyNames";
import { AuthProxy } from "../model/proxy/AuthProxy";

export class AuthCommand extends SimpleCommand {
  execute(notification: Notification): void {
    const authProxy = this.facade?.retrieveProxy(ProxyNames.AUTH_PROXY) as AuthProxy;
    if (!authProxy) return;

    const initData = notification.body?.initData;
    if (initData) {
      authProxy.authenticate(initData);
    } else {
      authProxy.authenticateWithTelegram();
    }
  }
}
