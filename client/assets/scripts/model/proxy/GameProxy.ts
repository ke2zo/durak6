/**
 * Game Proxy - управление состоянием игры
 */

import { Proxy } from "../../core/PureMVC";
import { ProxyNames } from "../../constants/ProxyNames";
import { Notifications } from "../../constants/Notifications";
import { GameState, MatchmakingResponse, RoomConfig } from "../../types/GameTypes";

export class GameProxy extends Proxy {
  public static NAME = ProxyNames.GAME_PROXY;

  private gameState: GameState | null = null;
  private apiBaseUrl: string = "";

  constructor() {
    super(GameProxy.NAME);
    this.apiBaseUrl = (window as any).API_BASE_URL || "";
  }

  setApiBaseUrl(url: string): void {
    this.apiBaseUrl = url;
  }

  getGameState(): GameState | null {
    return this.gameState;
  }

  setGameState(state: GameState): void {
    const oldPhase = this.gameState?.phase;
    this.gameState = state;
    
    this.sendNotification(Notifications.GAME_STATE_UPDATED, state);
    
    if (oldPhase !== state.phase) {
      this.sendNotification(Notifications.GAME_PHASE_CHANGED, {
        oldPhase,
        newPhase: state.phase,
      });
    }
  }

  async requestMatchmaking(config: RoomConfig): Promise<void> {
    const authProxy = this.facade?.retrieveProxy(ProxyNames.AUTH_PROXY) as any;
    if (!authProxy || !authProxy.isAuthenticated()) {
      this.sendNotification(Notifications.MATCHMAKING_FAILED, {
        error: "Not authenticated",
      });
      return;
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/matchmaking`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authProxy.getSessionToken()}`,
        },
        body: JSON.stringify(config),
      });

      const data: MatchmakingResponse = await response.json();

      if (data.ok) {
        if (data.status === "matched" && data.roomId) {
          this.sendNotification(Notifications.MATCHMAKING_SUCCESS, {
            roomId: data.roomId,
            wsUrl: data.wsUrl,
          });
        } else {
          this.sendNotification(Notifications.MATCHMAKING_QUEUED);
        }
      } else {
        this.sendNotification(Notifications.MATCHMAKING_FAILED, {
          error: data.error || "Matchmaking failed",
        });
      }
    } catch (error: any) {
      this.sendNotification(Notifications.MATCHMAKING_FAILED, {
        error: error.message || "Network error",
      });
    }
  }

  isMyTurn(): boolean {
    if (!this.gameState) return false;
    const { you, attacker, defender, allowed } = this.gameState;
    return you === attacker || you === defender || 
           allowed.attack || allowed.defend || allowed.transfer || 
           allowed.take || allowed.beat || allowed.pass;
  }

  canAttack(): boolean {
    return this.gameState?.allowed.attack || false;
  }

  canDefend(): boolean {
    return this.gameState?.allowed.defend || false;
  }

  canTransfer(): boolean {
    return this.gameState?.allowed.transfer || false;
  }

  canTake(): boolean {
    return this.gameState?.allowed.take || false;
  }

  canBeat(): boolean {
    return this.gameState?.allowed.beat || false;
  }

  canPass(): boolean {
    return this.gameState?.allowed.pass || false;
  }
}
