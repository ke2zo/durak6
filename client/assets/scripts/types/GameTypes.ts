/**
 * Game Types - соответствуют backend типам
 */

export type Mode = "podkidnoy" | "perevodnoy";
export type DeckSize = 24 | 36;
export type Suit = "S" | "H" | "D" | "C";
export type Rank = 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // J=11 Q=12 K=13 A=14
export type Card = string; // e.g. "H9", "SJ", "DA"
export type Phase = "playing" | "finished" | "missing";

export interface RoomConfig {
  mode: Mode;
  deckSize: DeckSize;
  maxPlayers: 2 | 3 | 4;
}

export interface TablePair {
  a: Card;
  d: Card | null;
}

export interface PlayerInfo {
  id: string;
  active: boolean;
  count: number;
}

export interface AllowedActions {
  attack: boolean;
  defend: boolean;
  transfer: boolean;
  take: boolean;
  beat: boolean;
  pass: boolean;
}

export interface GameState {
  roomId: string;
  phase: Phase;
  config: RoomConfig;
  players: string[];
  you: string;
  attacker: string;
  defender: string;
  trumpSuit: Suit;
  trumpCard: Card;
  deckCount: number;
  yourHand: Card[];
  others: PlayerInfo[];
  table: TablePair[];
  discardCount: number;
  takeDeclared: boolean;
  passed: string[];
  allowed: AllowedActions;
  updatedAt: number;
  loser: string | null;
}

export interface ClientMessage {
  type: "JOIN" | "ATTACK" | "DEFEND" | "TRANSFER" | "TAKE" | "BEAT" | "PASS";
  sessionToken?: string;
  card?: Card;
  attackIndex?: number;
}

export interface ServerMessage {
  type: "STATE" | "INFO" | "ERROR";
  state?: GameState;
  message?: string;
  code?: string;
  detail?: string;
}

export interface AuthResponse {
  ok: boolean;
  sessionToken?: string;
  user?: {
    id: string;
    first_name?: string;
    username?: string;
  };
  error?: string;
}

export interface MatchmakingResponse {
  ok: boolean;
  status?: "queued" | "matched";
  roomId?: string;
  wsUrl?: string;
  error?: string;
}
