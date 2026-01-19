/**
 * Game Mediator - управление игровой сценой
 */

import { Mediator } from "../../core/PureMVC";
import { MediatorNames } from "../constants/MediatorNames";
import { Notifications } from "../../constants/Notifications";
import { Notification } from "../../core/PureMVC";
import { ProxyNames } from "../../constants/ProxyNames";
import { GameProxy } from "../../model/proxy/GameProxy";
import { GameState } from "../../types/GameTypes";

const { ccclass, property } = cc._decorator;

@ccclass("GameMediator")
export class GameMediator extends Mediator {
  public static NAME = MediatorNames.GAME_MEDIATOR;

  @property(cc.Node)
  handContainer: cc.Node = null!;

  @property(cc.Node)
  tableContainer: cc.Node = null!;

  @property(cc.Node)
  playersContainer: cc.Node = null!;

  @property(cc.Node)
  actionButtonsContainer: cc.Node = null!;

  @property(cc.Label)
  trumpLabel: cc.Label = null!;

  @property(cc.Label)
  deckCountLabel: cc.Label = null!;

  @property(cc.Label)
  phaseLabel: cc.Label = null!;

  @property(cc.Prefab)
  cardPrefab: cc.Prefab = null!;

  @property(cc.Prefab)
  tableCardPrefab: cc.Prefab = null!;

  @property(cc.Prefab)
  playerInfoPrefab: cc.Prefab = null!;

  private selectedCard: string | null = null;
  private selectedAttackIndex: number | null = null;

  constructor() {
    super(GameMediator.NAME);
  }

  listNotificationInterests(): string[] {
    return [
      Notifications.GAME_STATE_UPDATED,
      Notifications.GAME_PHASE_CHANGED,
      Notifications.CARD_SELECTED,
      Notifications.TABLE_CARD_SELECTED,
      Notifications.MATCHMAKING_SUCCESS,
    ];
  }

  handleNotification(notification: Notification): void {
    switch (notification.name) {
      case Notifications.GAME_STATE_UPDATED:
        this.updateGameState(notification.body as GameState);
        break;
      case Notifications.GAME_PHASE_CHANGED:
        this.updatePhase(notification.body);
        break;
      case Notifications.CARD_SELECTED:
        this.onCardSelected(notification.body?.card);
        break;
      case Notifications.TABLE_CARD_SELECTED:
        this.onTableCardSelected(notification.body?.index);
        break;
      case Notifications.MATCHMAKING_SUCCESS:
        this.onMatchmakingSuccess(notification.body);
        break;
    }
  }

  onRegister(): void {
    // Инициализация UI
  }

  onRemove(): void {
    // Очистка
  }

  private updateGameState(state: GameState): void {
    if (!state) return;

    this.updateHand(state.yourHand);
    this.updateTable(state.table);
    this.updatePlayers(state);
    this.updateActionButtons(state.allowed);
    this.updateInfo(state);
  }

  private updateHand(cards: string[]): void {
    if (!this.handContainer || !this.cardPrefab) return;

    this.handContainer.removeAllChildren();

    cards.forEach((card, index) => {
      const cardNode = cc.instantiate(this.cardPrefab);
      const cardComponent = cardNode.getComponent("CardComponent");
      if (cardComponent) {
        cardComponent.setCard(card);
        cardComponent.setSelectable(true);
        cardComponent.onClick = () => {
          this.sendNotification(Notifications.CARD_SELECTED, { card });
        };
      }
      cardNode.setPosition(index * 60 - (cards.length - 1) * 30, 0);
      this.handContainer.addChild(cardNode);
    });
  }

  private updateTable(table: any[]): void {
    if (!this.tableContainer || !this.tableCardPrefab) return;

    this.tableContainer.removeAllChildren();

    table.forEach((pair, index) => {
      const pairNode = new cc.Node("TablePair");
      pairNode.setPosition(index * 120 - (table.length - 1) * 60, 0);

      // Атакующая карта
      const attackCard = cc.instantiate(this.tableCardPrefab);
      const attackComponent = attackCard.getComponent("CardComponent");
      if (attackComponent) {
        attackComponent.setCard(pair.a);
        attackComponent.setSelectable(false);
        attackComponent.onClick = () => {
          this.sendNotification(Notifications.TABLE_CARD_SELECTED, { index });
        };
      }
      attackCard.setPosition(-30, 0);
      pairNode.addChild(attackCard);

      // Защитная карта
      if (pair.d) {
        const defendCard = cc.instantiate(this.tableCardPrefab);
        const defendComponent = defendCard.getComponent("CardComponent");
        if (defendComponent) {
          defendComponent.setCard(pair.d);
          defendComponent.setSelectable(false);
        }
        defendCard.setPosition(30, 0);
        pairNode.addChild(defendCard);
      }

      this.tableContainer.addChild(pairNode);
    });
  }

  private updatePlayers(state: GameState): void {
    if (!this.playersContainer || !this.playerInfoPrefab) return;

    this.playersContainer.removeAllChildren();

    state.others.forEach((player, index) => {
      const playerNode = cc.instantiate(this.playerInfoPrefab);
      const playerComponent = playerNode.getComponent("PlayerInfoComponent");
      if (playerComponent) {
        playerComponent.setPlayer(player, state.attacker === player.id, state.defender === player.id);
      }
      this.playersContainer.addChild(playerNode);
    });
  }

  private updateActionButtons(allowed: any): void {
    if (!this.actionButtonsContainer) return;

    const buttons = this.actionButtonsContainer.children;
    buttons.forEach((button) => {
      const buttonName = button.name.toLowerCase();
      if (buttonName.includes("attack")) {
        button.getComponent(cc.Button).interactable = allowed.attack;
      } else if (buttonName.includes("defend")) {
        button.getComponent(cc.Button).interactable = allowed.defend;
      } else if (buttonName.includes("transfer")) {
        button.getComponent(cc.Button).interactable = allowed.transfer;
      } else if (buttonName.includes("take")) {
        button.getComponent(cc.Button).interactable = allowed.take;
      } else if (buttonName.includes("beat")) {
        button.getComponent(cc.Button).interactable = allowed.beat;
      } else if (buttonName.includes("pass")) {
        button.getComponent(cc.Button).interactable = allowed.pass;
      }
    });
  }

  private updateInfo(state: GameState): void {
    if (this.trumpLabel) {
      this.trumpLabel.string = `Козырь: ${state.trumpSuit} (${state.trumpCard})`;
    }
    if (this.deckCountLabel) {
      this.deckCountLabel.string = `Колода: ${state.deckCount}`;
    }
    if (this.phaseLabel) {
      this.phaseLabel.string = state.phase === "playing" ? "Игра" : "Завершено";
    }
  }

  private updatePhase(data: any): void {
    // Обработка смены фазы игры
  }

  private onCardSelected(card: string): void {
    this.selectedCard = card;
    const gameProxy = this.facade?.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;
    if (!gameProxy) return;

    const state = gameProxy.getGameState();
    if (!state) return;

    if (state.allowed.attack) {
      this.sendNotification(Notifications.ATTACK_REQUEST, { card });
    } else if (state.allowed.defend && this.selectedAttackIndex !== null) {
      this.sendNotification(Notifications.DEFEND_REQUEST, {
        attackIndex: this.selectedAttackIndex,
        card,
      });
    } else if (state.allowed.transfer) {
      this.sendNotification(Notifications.TRANSFER_REQUEST, { card });
    }
  }

  private onTableCardSelected(index: number): void {
    this.selectedAttackIndex = index;
  }

  private onMatchmakingSuccess(data: any): void {
    if (data.roomId && data.wsUrl) {
      this.sendNotification(Notifications.WS_CONNECT, {
        roomId: data.roomId,
        wsUrl: data.wsUrl,
      });
    }
  }

  // Методы для кнопок действий
  onAttackClick(): void {
    if (this.selectedCard) {
      this.sendNotification(Notifications.ATTACK_REQUEST, { card: this.selectedCard });
    }
  }

  onDefendClick(): void {
    if (this.selectedCard && this.selectedAttackIndex !== null) {
      this.sendNotification(Notifications.DEFEND_REQUEST, {
        attackIndex: this.selectedAttackIndex,
        card: this.selectedCard,
      });
    }
  }

  onTransferClick(): void {
    if (this.selectedCard) {
      this.sendNotification(Notifications.TRANSFER_REQUEST, { card: this.selectedCard });
    }
  }

  onTakeClick(): void {
    this.sendNotification(Notifications.TAKE_REQUEST);
  }

  onBeatClick(): void {
    this.sendNotification(Notifications.BEAT_REQUEST);
  }

  onPassClick(): void {
    this.sendNotification(Notifications.PASS_REQUEST);
  }
}
