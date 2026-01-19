/**
 * Card Component - компонент карты
 */

import { Card, Suit } from "../../types/GameTypes";
import { getCardDisplayName, getCardSuit, getSuitColor, isTrump } from "../../utils/CardUtils";

const { ccclass, property } = cc._decorator;

@ccclass("CardComponent")
export class CardComponent extends cc.Component {
  @property(cc.Sprite)
  cardSprite: cc.Sprite = null!;

  @property(cc.Label)
  rankLabel: cc.Label = null!;

  @property(cc.Label)
  suitLabel: cc.Label = null!;

  @property(cc.Node)
  trumpIndicator: cc.Node = null!;

  @property(cc.Button)
  button: cc.Button = null!;

  private card: Card | null = null;
  private selectable: boolean = false;
  private selected: boolean = false;
  private trumpSuit: Suit | null = null;

  public onClick: (() => void) | null = null;

  onLoad(): void {
    if (this.button) {
      this.button.node.on("click", this.onCardClick, this);
    }
  }

  onDestroy(): void {
    if (this.button) {
      this.button.node.off("click", this.onCardClick, this);
    }
  }

  setCard(card: Card): void {
    this.card = card;
    this.updateDisplay();
  }

  setTrumpSuit(trumpSuit: Suit): void {
    this.trumpSuit = trumpSuit;
    this.updateDisplay();
  }

  setSelectable(selectable: boolean): void {
    this.selectable = selectable;
    if (this.button) {
      this.button.interactable = selectable;
    }
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.updateDisplay();
  }

  private updateDisplay(): void {
    if (!this.card) return;

    const displayName = getCardDisplayName(this.card);
    const suit = getCardSuit(this.card);
    const color = suit ? getSuitColor(suit) : "#000000";

    if (this.rankLabel) {
      this.rankLabel.string = displayName;
      this.rankLabel.node.color = cc.Color.fromHEX(this.rankLabel.node.color, color);
    }

    if (this.suitLabel) {
      this.suitLabel.string = displayName;
      this.suitLabel.node.color = cc.Color.fromHEX(this.suitLabel.node.color, color);
    }

    if (this.trumpIndicator && this.trumpSuit) {
      this.trumpIndicator.active = isTrump(this.card, this.trumpSuit);
    }

    // Визуальная обратная связь для выбранной карты
    if (this.selected) {
      this.node.setScale(1.1, 1.1);
      this.node.setPositionY(this.node.position.y + 20);
    } else {
      this.node.setScale(1.0, 1.0);
      this.node.setPositionY(this.node.position.y - 20);
    }
  }

  private onCardClick(): void {
    if (this.selectable && this.onClick) {
      this.setSelected(!this.selected);
      this.onClick();
    }
  }

  getCard(): Card | null {
    return this.card;
  }
}
