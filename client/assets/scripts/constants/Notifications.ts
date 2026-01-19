/**
 * Notification Constants
 */

export class Notifications {
  // Application
  static STARTUP = "startup";
  static SHUTDOWN = "shutdown";

  // Authentication
  static AUTH_REQUEST = "auth_request";
  static AUTH_SUCCESS = "auth_success";
  static AUTH_FAILED = "auth_failed";

  // Matchmaking
  static MATCHMAKING_REQUEST = "matchmaking_request";
  static MATCHMAKING_SUCCESS = "matchmaking_success";
  static MATCHMAKING_FAILED = "matchmaking_failed";
  static MATCHMAKING_QUEUED = "matchmaking_queued";

  // WebSocket
  static WS_CONNECT = "ws_connect";
  static WS_CONNECTED = "ws_connected";
  static WS_DISCONNECTED = "ws_disconnected";
  static WS_ERROR = "ws_error";
  static WS_JOIN = "ws_join";
  static WS_JOINED = "ws_joined";

  // Game State
  static GAME_STATE_UPDATED = "game_state_updated";
  static GAME_PHASE_CHANGED = "game_phase_changed";

  // Game Actions
  static ATTACK_REQUEST = "attack_request";
  static DEFEND_REQUEST = "defend_request";
  static TRANSFER_REQUEST = "transfer_request";
  static TAKE_REQUEST = "take_request";
  static BEAT_REQUEST = "beat_request";
  static PASS_REQUEST = "pass_request";

  // UI
  static CARD_SELECTED = "card_selected";
  static CARD_DESELECTED = "card_deselected";
  static TABLE_CARD_SELECTED = "table_card_selected";
  static SHOW_MESSAGE = "show_message";
  static HIDE_MESSAGE = "hide_message";
}
