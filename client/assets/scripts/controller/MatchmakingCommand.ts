/**
 * Matchmaking Command - обработка поиска матча
 */

import { SimpleCommand } from "../core/PureMVC";
import { Notification } from "../core/PureMVC";
import { ProxyNames } from "../constants/ProxyNames";
import { GameProxy } from "../model/proxy/GameProxy";
import { RoomConfig } from "../types/GameTypes";

export class MatchmakingCommand extends SimpleCommand {
  execute(notification: Notification): void {
    const gameProxy = this.facade?.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;
    if (!gameProxy) return;

    const config: RoomConfig = notification.body?.config || {
      mode: "podkidnoy",
      deckSize: 36,
      maxPlayers: 2,
    };

    gameProxy.requestMatchmaking(config);
  }
}
