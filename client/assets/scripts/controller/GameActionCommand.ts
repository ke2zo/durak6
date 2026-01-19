/**
 * Game Action Commands - обработка игровых действий
 */

import { SimpleCommand } from "../core/PureMVC";
import { Notification } from "../core/PureMVC";
import { ProxyNames } from "../constants/ProxyNames";
import { WebSocketProxy } from "../model/proxy/WebSocketProxy";
import { GameProxy } from "../model/proxy/GameProxy";

export class AttackCommand extends SimpleCommand {
  execute(notification: Notification): void {
    const wsProxy = this.facade?.retrieveProxy(ProxyNames.WEBSOCKET_PROXY) as WebSocketProxy;
    const gameProxy = this.facade?.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;
    
    if (!wsProxy || !gameProxy) return;
    if (!gameProxy.canAttack()) return;

    const card = notification.body?.card;
    if (card) {
      wsProxy.attack(card);
    }
  }
}

export class DefendCommand extends SimpleCommand {
  execute(notification: Notification): void {
    const wsProxy = this.facade?.retrieveProxy(ProxyNames.WEBSOCKET_PROXY) as WebSocketProxy;
    const gameProxy = this.facade?.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;
    
    if (!wsProxy || !gameProxy) return;
    if (!gameProxy.canDefend()) return;

    const { attackIndex, card } = notification.body || {};
    if (attackIndex !== undefined && card) {
      wsProxy.defend(attackIndex, card);
    }
  }
}

export class TransferCommand extends SimpleCommand {
  execute(notification: Notification): void {
    const wsProxy = this.facade?.retrieveProxy(ProxyNames.WEBSOCKET_PROXY) as WebSocketProxy;
    const gameProxy = this.facade?.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;
    
    if (!wsProxy || !gameProxy) return;
    if (!gameProxy.canTransfer()) return;

    const card = notification.body?.card;
    if (card) {
      wsProxy.transfer(card);
    }
  }
}

export class TakeCommand extends SimpleCommand {
  execute(notification: Notification): void {
    const wsProxy = this.facade?.retrieveProxy(ProxyNames.WEBSOCKET_PROXY) as WebSocketProxy;
    const gameProxy = this.facade?.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;
    
    if (!wsProxy || !gameProxy) return;
    if (!gameProxy.canTake()) return;

    wsProxy.take();
  }
}

export class BeatCommand extends SimpleCommand {
  execute(notification: Notification): void {
    const wsProxy = this.facade?.retrieveProxy(ProxyNames.WEBSOCKET_PROXY) as WebSocketProxy;
    const gameProxy = this.facade?.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;
    
    if (!wsProxy || !gameProxy) return;
    if (!gameProxy.canBeat()) return;

    wsProxy.beat();
  }
}

export class PassCommand extends SimpleCommand {
  execute(notification: Notification): void {
    const wsProxy = this.facade?.retrieveProxy(ProxyNames.WEBSOCKET_PROXY) as WebSocketProxy;
    const gameProxy = this.facade?.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;
    
    if (!wsProxy || !gameProxy) return;
    if (!gameProxy.canPass()) return;

    wsProxy.pass();
  }
}
