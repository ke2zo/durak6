/**
 * Game Configuration
 */

export class GameConfig {
  // API Base URL - установите URL вашего Cloudflare Worker
  static API_BASE_URL: string = "";

  // WebSocket reconnect settings
  static MAX_RECONNECT_ATTEMPTS: number = 5;
  static RECONNECT_DELAY: number = 1000;

  // Card display settings
  static CARD_WIDTH: number = 80;
  static CARD_HEIGHT: number = 120;
  static CARD_SPACING: number = 60;

  // Animation settings
  static CARD_ANIMATION_DURATION: number = 0.3;
  static CARD_SELECT_SCALE: number = 1.1;
  static CARD_SELECT_OFFSET: number = 20;

  // UI settings
  static MESSAGE_DISPLAY_DURATION: number = 3; // seconds

  static init(): void {
    // Можно загрузить из конфига или переменных окружения
    if (typeof window !== "undefined") {
      const config = (window as any).GAME_CONFIG;
      if (config) {
        if (config.API_BASE_URL) {
          GameConfig.API_BASE_URL = config.API_BASE_URL;
        }
      }

      // Устанавливаем в глобальную переменную для использования в прокси
      (window as any).API_BASE_URL = GameConfig.API_BASE_URL;
    }
  }
}
