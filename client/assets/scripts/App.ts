/**
 * Application Entry Point
 */

import { ApplicationFacade } from "./core/ApplicationFacade";
import { Notifications } from "./constants/Notifications";
import { MediatorNames } from "./constants/MediatorNames";
import { GameMediator } from "./view/mediator/GameMediator";
import { MenuMediator } from "./view/mediator/MenuMediator";
import { MessageMediator } from "./view/mediator/MessageMediator";
import { GameConfig } from "./config/GameConfig";

const { ccclass, property } = cc._decorator;

@ccclass("App")
export class App extends cc.Component {
  @property(cc.Node)
  menuScene: cc.Node = null!;

  @property(cc.Node)
  gameScene: cc.Node = null!;

  private facade: ApplicationFacade | null = null;

  onLoad(): void {
    // Инициализация конфига
    GameConfig.init();

    // Инициализация фасада
    this.facade = ApplicationFacade.getInstance();

    // Запускаем приложение
    this.facade.startup();

    // Регистрируем медиаторы
    if (this.menuScene) {
      const menuMediator = this.menuScene.getComponent(MenuMediator);
      if (menuMediator) {
        this.facade.registerMediator(menuMediator);
      }
    }

    if (this.gameScene) {
      const gameMediator = this.gameScene.getComponent(GameMediator);
      if (gameMediator) {
        this.facade.registerMediator(gameMediator);
      }
    }

    // Регистрируем медиатор сообщений (если есть глобальный узел)
    const messageNode = cc.find("Canvas/MessagePanel");
    if (messageNode) {
      const messageMediator = messageNode.getComponent(MessageMediator);
      if (messageMediator) {
        this.facade.registerMediator(messageMediator);
      }
    }

    // Автоматическая авторизация при загрузке (если доступен Telegram WebApp)
    if ((window as any).Telegram?.WebApp?.initData) {
      this.facade.sendNotification(Notifications.AUTH_REQUEST);
    }
  }

  onDestroy(): void {
    // Очистка при выходе
    if (this.facade) {
      const wsProxy = this.facade.retrieveProxy("WebSocketProxy") as any;
      if (wsProxy) {
        wsProxy.disconnect();
      }
    }
  }
}
