/**
 * Card Utilities
 */

import { Card, Suit, Rank } from "../types/GameTypes";

const SUITS: Suit[] = ["S", "H", "D", "C"];
const SUIT_NAMES: Record<Suit, string> = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣"
};

const SUIT_COLORS: Record<Suit, string> = {
  S: "#000000",
  H: "#FF0000",
  D: "#FF0000",
  C: "#000000"
};

const RANK_NAMES: Record<Rank, string> = {
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A"
};

export function parseCard(card: Card): { suit: Suit; rank: Rank } | null {
  if (!card || card.length < 2) return null;
  const suit = card[0] as Suit;
  const rStr = card.slice(1);
  if (!SUITS.includes(suit)) return null;
  
  let rank: Rank | null = null;
  if (rStr === "J") rank = 11;
  else if (rStr === "Q") rank = 12;
  else if (rStr === "K") rank = 13;
  else if (rStr === "A") rank = 14;
  else {
    const n = Number(rStr);
    if ([6, 7, 8, 9, 10].includes(n)) rank = n as Rank;
  }
  
  if (!rank) return null;
  return { suit, rank };
}

export function getCardSuit(card: Card): Suit | null {
  const parsed = parseCard(card);
  return parsed ? parsed.suit : null;
}

export function getCardRank(card: Card): Rank | null {
  const parsed = parseCard(card);
  return parsed ? parsed.rank : null;
}

export function getSuitSymbol(suit: Suit): string {
  return SUIT_NAMES[suit];
}

export function getSuitColor(suit: Suit): string {
  return SUIT_COLORS[suit];
}

export function getRankName(rank: Rank): string {
  return RANK_NAMES[rank];
}

export function getCardDisplayName(card: Card): string {
  const parsed = parseCard(card);
  if (!parsed) return card;
  return `${getSuitSymbol(parsed.suit)}${getRankName(parsed.rank)}`;
}

export function isTrump(card: Card, trumpSuit: Suit): boolean {
  return getCardSuit(card) === trumpSuit;
}

export function cardBeats(defCard: Card, atkCard: Card, trumpSuit: Suit): boolean {
  const d = parseCard(defCard);
  const a = parseCard(atkCard);
  if (!d || !a) return false;
  
  if (d.suit === a.suit) return d.rank > a.rank;
  if (d.suit === trumpSuit && a.suit !== trumpSuit) return true;
  return false;
}

export function sortCardsBySuitThenRank(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const pa = parseCard(a);
    const pb = parseCard(b);
    if (!pa || !pb) return 0;
    
    if (pa.suit !== pb.suit) {
      return pa.suit < pb.suit ? -1 : 1;
    }
    return pa.rank - pb.rank;
  });
}

export function sortCardsByRankThenSuit(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const pa = parseCard(a);
    const pb = parseCard(b);
    if (!pa || !pb) return 0;
    
    if (pa.rank !== pb.rank) {
      return pa.rank - pb.rank;
    }
    return pa.suit < pb.suit ? -1 : 1;
  });
}
