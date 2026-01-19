# Примеры использования

## Базовое использование

### Инициализация приложения

```typescript
import { ApplicationFacade } from "./assets/scripts/core/ApplicationFacade";
import { Notifications } from "./assets/scripts/constants/Notifications";

// Получаем фасад
const facade = ApplicationFacade.getInstance();

// Запускаем приложение
facade.startup();
```

### Авторизация

```typescript
// Автоматическая авторизация через Telegram WebApp
facade.sendNotification(Notifications.AUTH_REQUEST);

// Или с явным initData
facade.sendNotification(Notifications.AUTH_REQUEST, {
  initData: "user=%7B%22id%22%3A123%7D&hash=..."
});
```

### Поиск матча

```typescript
facade.sendNotification(Notifications.MATCHMAKING_REQUEST, {
  config: {
    mode: "podkidnoy",      // или "perevodnoy"
    deckSize: 36,            // или 24
    maxPlayers: 2            // или 3, 4
  }
});
```

### Игровые действия

```typescript
// Атака картой
facade.sendNotification(Notifications.ATTACK_REQUEST, {
  card: "H9"  // Формат: масть + ранг (H=♥, S=♠, D=♦, C=♣)
});

// Защита
facade.sendNotification(Notifications.DEFEND_REQUEST, {
  attackIndex: 0,  // Индекс атакующей карты на столе
  card: "H10"
});

// Перевод (только в режиме переводной)
facade.sendNotification(Notifications.TRANSFER_REQUEST, {
  card: "H9"
});

// Взять карты
facade.sendNotification(Notifications.TAKE_REQUEST);

// Отбить все карты
facade.sendNotification(Notifications.BEAT_REQUEST);

// Пасс (пропустить ход)
facade.sendNotification(Notifications.PASS_REQUEST);
```

## Работа с прокси напрямую

### Получение состояния игры

```typescript
import { ProxyNames } from "./assets/scripts/constants/ProxyNames";
import { GameProxy } from "./assets/scripts/model/proxy/GameProxy";

const gameProxy = facade.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;
const gameState = gameProxy.getGameState();

if (gameState) {
  console.log("Моя рука:", gameState.yourHand);
  console.log("Стол:", gameState.table);
  console.log("Козырь:", gameState.trumpSuit);
  console.log("Можно атаковать:", gameState.allowed.attack);
}
```

### Проверка доступных действий

```typescript
const gameProxy = facade.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;

if (gameProxy.canAttack()) {
  // Можно атаковать
}

if (gameProxy.canDefend()) {
  // Можно защищаться
}

if (gameProxy.isMyTurn()) {
  // Мой ход
}
```

### Работа с WebSocket

```typescript
import { ProxyNames } from "./assets/scripts/constants/ProxyNames";
import { WebSocketProxy } from "./assets/scripts/model/proxy/WebSocketProxy";

const wsProxy = facade.retrieveProxy(ProxyNames.WEBSOCKET_PROXY) as WebSocketProxy;

// Подключение
wsProxy.connect("room-id", "/ws/room-id");

// Проверка соединения
if (wsProxy.getIsConnected()) {
  console.log("WebSocket подключен");
}

// Отключение
wsProxy.disconnect();
```

## Работа с картами

### Парсинг карты

```typescript
import { parseCard, getCardDisplayName, isTrump } from "./assets/scripts/utils/CardUtils";

const card = "H9";
const parsed = parseCard(card);
// { suit: "H", rank: 9 }

const displayName = getCardDisplayName(card);
// "♥9"

const isTrumpCard = isTrump(card, "H");
// true, если H - козырь
```

### Сортировка карт

```typescript
import { sortCardsBySuitThenRank } from "./assets/scripts/utils/CardUtils";

const hand = ["H9", "S10", "H10", "D9"];
const sorted = sortCardsBySuitThenRank(hand);
// ["D9", "H9", "H10", "S10"]
```

### Проверка, бьет ли карта

```typescript
import { cardBeats } from "./assets/scripts/utils/CardUtils";

const defenderCard = "H10";
const attackerCard = "H9";
const trumpSuit = "S";

const beats = cardBeats(defenderCard, attackerCard, trumpSuit);
// true, так как H10 > H9
```

## Создание кастомных медиаторов

```typescript
import { Mediator } from "./assets/scripts/core/PureMVC";
import { Notifications } from "./assets/scripts/constants/Notifications";
import { Notification } from "./assets/scripts/core/PureMVC";

const { ccclass } = cc._decorator;

@ccclass("CustomMediator")
export class CustomMediator extends Mediator {
  public static NAME = "CustomMediator";

  listNotificationInterests(): string[] {
    return [
      Notifications.GAME_STATE_UPDATED,
      Notifications.SHOW_MESSAGE,
    ];
  }

  handleNotification(notification: Notification): void {
    switch (notification.name) {
      case Notifications.GAME_STATE_UPDATED:
        this.onGameStateUpdated(notification.body);
        break;
      case Notifications.SHOW_MESSAGE:
        this.onShowMessage(notification.body);
        break;
    }
  }

  onRegister(): void {
    // Инициализация
  }

  onRemove(): void {
    // Очистка
  }

  private onGameStateUpdated(state: any): void {
    // Обработка обновления состояния
  }

  private onShowMessage(data: any): void {
    // Показать сообщение
  }
}

// Регистрация
facade.registerMediator(new CustomMediator());
```

## Создание кастомных команд

```typescript
import { SimpleCommand } from "./assets/scripts/core/PureMVC";
import { Notification } from "./assets/scripts/core/PureMVC";

export class CustomCommand extends SimpleCommand {
  execute(notification: Notification): void {
    const data = notification.body;
    // Обработка команды
  }
}

// Регистрация
facade.registerCommand("CUSTOM_NOTIFICATION", CustomCommand);

// Использование
facade.sendNotification("CUSTOM_NOTIFICATION", { data: "value" });
```

## Обработка событий в компонентах

```typescript
import { CardComponent } from "./assets/scripts/view/component/CardComponent";

// В вашем компоненте
const cardComponent = node.getComponent(CardComponent);
cardComponent.setCard("H9");
cardComponent.setSelectable(true);
cardComponent.setTrumpSuit("H");
cardComponent.onClick = () => {
  console.log("Карта выбрана:", cardComponent.getCard());
  facade.sendNotification(Notifications.CARD_SELECTED, {
    card: cardComponent.getCard()
  });
};
```

## Интеграция с Telegram WebApp

```typescript
// Проверка доступности Telegram WebApp
if (window.Telegram?.WebApp) {
  const tg = window.Telegram.WebApp;
  
  // Инициализация
  tg.ready();
  tg.expand();
  
  // Получение initData для авторизации
  const initData = tg.initData;
  
  // Отправка на авторизацию
  facade.sendNotification(Notifications.AUTH_REQUEST, { initData });
  
  // Обработка закрытия
  tg.onEvent("viewportChanged", () => {
    // Обработка изменения размера
  });
}
```

## Обработка ошибок

```typescript
// В медиаторе
listNotificationInterests(): string[] {
  return [
    Notifications.WS_ERROR,
    Notifications.AUTH_FAILED,
    Notifications.MATCHMAKING_FAILED,
  ];
}

handleNotification(notification: Notification): void {
  switch (notification.name) {
    case Notifications.WS_ERROR:
      this.showError("Ошибка соединения");
      break;
    case Notifications.AUTH_FAILED:
      this.showError("Ошибка авторизации");
      break;
    case Notifications.MATCHMAKING_FAILED:
      this.showError("Не удалось найти матч");
      break;
  }
}
```

## Отладка

```typescript
// Включение логирования в прокси
const wsProxy = facade.retrieveProxy(ProxyNames.WEBSOCKET_PROXY) as WebSocketProxy;
console.log("WebSocket connected:", wsProxy.getIsConnected());

const gameProxy = facade.retrieveProxy(ProxyNames.GAME_PROXY) as GameProxy;
const state = gameProxy.getGameState();
console.log("Game state:", JSON.stringify(state, null, 2));
```
