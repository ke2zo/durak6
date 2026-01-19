/**
 * Menu Mediator - управление меню
 */

import { Mediator } from "../../core/PureMVC";
import { MediatorNames } from "../../constants/MediatorNames";
import { Notifications } from "../../constants/Notifications";
import { Notification } from "../../core/PureMVC";
import { RoomConfig } from "../../types/GameTypes";

const { ccclass, property } = cc._decorator;

@ccclass("MenuMediator")
export class MenuMediator extends Mediator {
  public static NAME = MediatorNames.MENU_MEDIATOR;

  @property(cc.Button)
  authButton: cc.Button = null!;

  @property(cc.Button)
  matchmakingButton: cc.Button = null!;

  @property(cc.Dropdown)
  modeDropdown: cc.Dropdown = null!;

  @property(cc.Dropdown)
  deckSizeDropdown: cc.Dropdown = null!;

  @property(cc.Dropdown)
  playersDropdown: cc.Dropdown = null!;

  @property(cc.Label)
  statusLabel: cc.Label = null!;

  constructor() {
    super(MenuMediator.NAME);
  }

  listNotificationInterests(): string[] {
    return [
      Notifications.AUTH_SUCCESS,
      Notifications.AUTH_FAILED,
      Notifications.MATCHMAKING_SUCCESS,
      Notifications.MATCHMAKING_QUEUED,
      Notifications.MATCHMAKING_FAILED,
    ];
  }

  handleNotification(notification: Notification): void {
    switch (notification.name) {
      case Notifications.AUTH_SUCCESS:
        this.onAuthSuccess();
        break;
      case Notifications.AUTH_FAILED:
        this.onAuthFailed(notification.body);
        break;
      case Notifications.MATCHMAKING_SUCCESS:
        this.onMatchmakingSuccess();
        break;
      case Notifications.MATCHMAKING_QUEUED:
        this.onMatchmakingQueued();
        break;
      case Notifications.MATCHMAKING_FAILED:
        this.onMatchmakingFailed(notification.body);
        break;
    }
  }

  onRegister(): void {
    if (this.authButton) {
      this.authButton.node.on("click", this.onAuthClick, this);
    }
    if (this.matchmakingButton) {
      this.matchmakingButton.node.on("click", this.onMatchmakingClick, this);
    }
  }

  onRemove(): void {
    if (this.authButton) {
      this.authButton.node.off("click", this.onAuthClick, this);
    }
    if (this.matchmakingButton) {
      this.matchmakingButton.node.off("click", this.onMatchmakingClick, this);
    }
  }

  private onAuthClick(): void {
    this.sendNotification(Notifications.AUTH_REQUEST);
    this.updateStatus("Авторизация...");
  }

  private onMatchmakingClick(): void {
    const config: RoomConfig = {
      mode: this.getMode(),
      deckSize: this.getDeckSize(),
      maxPlayers: this.getMaxPlayers(),
    };

    this.sendNotification(Notifications.MATCHMAKING_REQUEST, { config });
    this.updateStatus("Поиск матча...");
  }

  private getMode(): "podkidnoy" | "perevodnoy" {
    if (!this.modeDropdown) return "podkidnoy";
    const index = this.modeDropdown.selectedIndex;
    return index === 1 ? "perevodnoy" : "podkidnoy";
  }

  private getDeckSize(): 24 | 36 {
    if (!this.deckSizeDropdown) return 36;
    const index = this.deckSizeDropdown.selectedIndex;
    return index === 0 ? 36 : 24;
  }

  private getMaxPlayers(): 2 | 3 | 4 {
    if (!this.playersDropdown) return 2;
    const index = this.playersDropdown.selectedIndex;
    if (index === 0) return 2;
    if (index === 1) return 3;
    return 4;
  }

  private updateStatus(text: string): void {
    if (this.statusLabel) {
      this.statusLabel.string = text;
    }
  }

  private onAuthSuccess(): void {
    this.updateStatus("Авторизован");
    if (this.matchmakingButton) {
      this.matchmakingButton.interactable = true;
    }
  }

  private onAuthFailed(data: any): void {
    this.updateStatus(`Ошибка: ${data?.error || "Неизвестная ошибка"}`);
  }

  private onMatchmakingSuccess(): void {
    this.updateStatus("Матч найден!");
  }

  private onMatchmakingQueued(): void {
    this.updateStatus("Ожидание игроков...");
  }

  private onMatchmakingFailed(data: any): void {
    this.updateStatus(`Ошибка: ${data?.error || "Неизвестная ошибка"}`);
  }
}
