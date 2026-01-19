/**
 * Message Mediator - управление сообщениями
 */

import { Mediator } from "../../core/PureMVC";
import { MediatorNames } from "../../constants/MediatorNames";
import { Notifications } from "../../constants/Notifications";
import { Notification } from "../../core/PureMVC";

const { ccclass, property } = cc._decorator;

@ccclass("MessageMediator")
export class MessageMediator extends Mediator {
  public static NAME = MediatorNames.MESSAGE_MEDIATOR;

  @property(cc.Node)
  messagePanel: cc.Node = null!;

  @property(cc.Label)
  messageLabel: cc.Label = null!;

  @property(cc.Button)
  closeButton: cc.Button = null!;

  private hideTimer: number = 0;

  constructor() {
    super(MessageMediator.NAME);
  }

  listNotificationInterests(): string[] {
    return [Notifications.SHOW_MESSAGE, Notifications.HIDE_MESSAGE];
  }

  handleNotification(notification: Notification): void {
    switch (notification.name) {
      case Notifications.SHOW_MESSAGE:
        this.showMessage(notification.body);
        break;
      case Notifications.HIDE_MESSAGE:
        this.hideMessage();
        break;
    }
  }

  onRegister(): void {
    if (this.closeButton) {
      this.closeButton.node.on("click", this.hideMessage, this);
    }
    if (this.messagePanel) {
      this.messagePanel.active = false;
    }
  }

  onRemove(): void {
    if (this.closeButton) {
      this.closeButton.node.off("click", this.hideMessage, this);
    }
  }

  private showMessage(data: any): void {
    if (!this.messagePanel || !this.messageLabel) return;

    const message = data?.message || "";
    const type = data?.type || "info";

    this.messageLabel.string = message;
    this.messagePanel.active = true;

    // Автоматическое скрытие через 3 секунды для info сообщений
    if (type === "info") {
      this.scheduleOnce(() => {
        this.hideMessage();
      }, 3);
    }
  }

  private hideMessage(): void {
    if (this.messagePanel) {
      this.messagePanel.active = false;
    }
  }
}
