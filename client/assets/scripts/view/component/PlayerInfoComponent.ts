/**
 * Player Info Component - информация об игроке
 */

import { PlayerInfo } from "../../types/GameTypes";

const { ccclass, property } = cc._decorator;

@ccclass("PlayerInfoComponent")
export class PlayerInfoComponent extends cc.Component {
  @property(cc.Label)
  nameLabel: cc.Label = null!;

  @property(cc.Label)
  cardsCountLabel: cc.Label = null!;

  @property(cc.Node)
  attackerIndicator: cc.Node = null!;

  @property(cc.Node)
  defenderIndicator: cc.Node = null!;

  @property(cc.Node)
  activeIndicator: cc.Node = null!;

  private player: PlayerInfo | null = null;

  setPlayer(player: PlayerInfo, isAttacker: boolean, isDefender: boolean): void {
    this.player = player;

    if (this.nameLabel) {
      this.nameLabel.string = `Игрок ${player.id}`;
    }

    if (this.cardsCountLabel) {
      this.cardsCountLabel.string = `Карт: ${player.count}`;
    }

    if (this.attackerIndicator) {
      this.attackerIndicator.active = isAttacker;
    }

    if (this.defenderIndicator) {
      this.defenderIndicator.active = isDefender;
    }

    if (this.activeIndicator) {
      this.activeIndicator.active = player.active;
    }
  }

  getPlayer(): PlayerInfo | null {
    return this.player;
  }
}
