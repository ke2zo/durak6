/**
 * Application Facade - главный фасад приложения
 */

import { Facade } from "./PureMVC";
import { Notifications } from "../constants/Notifications";
import { StartupCommand } from "../controller/StartupCommand";
import { AuthCommand } from "../controller/AuthCommand";
import { MatchmakingCommand } from "../controller/MatchmakingCommand";
import { WebSocketConnectCommand } from "../controller/WebSocketCommand";
import {
  AttackCommand,
  DefendCommand,
  TransferCommand,
  TakeCommand,
  BeatCommand,
  PassCommand,
} from "../controller/GameActionCommand";

export class ApplicationFacade extends Facade {
  private static instance: ApplicationFacade | null = null;

  static getInstance(): ApplicationFacade {
    if (!ApplicationFacade.instance) {
      ApplicationFacade.instance = new ApplicationFacade();
    }
    return ApplicationFacade.instance;
  }

  protected initializeController(): void {
    super.initializeController();

    // Регистрируем команды
    this.registerCommand(Notifications.STARTUP, StartupCommand);
    this.registerCommand(Notifications.AUTH_REQUEST, AuthCommand);
    this.registerCommand(Notifications.MATCHMAKING_REQUEST, MatchmakingCommand);
    this.registerCommand(Notifications.WS_CONNECT, WebSocketConnectCommand);
    this.registerCommand(Notifications.ATTACK_REQUEST, AttackCommand);
    this.registerCommand(Notifications.DEFEND_REQUEST, DefendCommand);
    this.registerCommand(Notifications.TRANSFER_REQUEST, TransferCommand);
    this.registerCommand(Notifications.TAKE_REQUEST, TakeCommand);
    this.registerCommand(Notifications.BEAT_REQUEST, BeatCommand);
    this.registerCommand(Notifications.PASS_REQUEST, PassCommand);
  }

  startup(): void {
    this.sendNotification(Notifications.STARTUP);
  }
}
