# Durak Card Game Client

Полноценная карточная игра "Дурак" на Cocos Creator с TypeScript, PureMVC архитектурой и интеграцией с Cloudflare backend.

## Структура проекта

```
client/
├── assets/
│   └── scripts/
│       ├── core/              # PureMVC framework
│       │   ├── PureMVC.ts
│       │   └── ApplicationFacade.ts
│       ├── model/              # Модели и прокси
│       │   └── proxy/
│       │       ├── AuthProxy.ts
│       │       ├── GameProxy.ts
│       │       └── WebSocketProxy.ts
│       ├── view/               # Представления и медиаторы
│       │   ├── mediator/
│       │   │   ├── GameMediator.ts
│       │   │   ├── MenuMediator.ts
│       │   │   └── MessageMediator.ts
│       │   └── component/
│       │       ├── CardComponent.ts
│       │       └── PlayerInfoComponent.ts
│       ├── controller/         # Контроллеры
│       │   ├── StartupCommand.ts
│       │   ├── AuthCommand.ts
│       │   ├── MatchmakingCommand.ts
│       │   ├── WebSocketCommand.ts
│       │   └── GameActionCommand.ts
│       ├── constants/          # Константы
│       │   ├── Notifications.ts
│       │   ├── ProxyNames.ts
│       │   └── MediatorNames.ts
│       ├── types/              # Типы
│       │   └── GameTypes.ts
│       ├── utils/              # Утилиты
│       │   └── CardUtils.ts
│       └── App.ts              # Точка входа
├── package.json
├── tsconfig.json
└── README.md
```

## Установка и настройка

### 1. Установка зависимостей

```bash
cd client
npm install
```

### 2. Настройка API URL

Установите базовый URL вашего Cloudflare backend:

```typescript
// В App.ts или в конфиге
(window as any).API_BASE_URL = "https://your-worker.workers.dev";
```

### 3. Настройка Cocos Creator

1. Откройте проект в Cocos Creator
2. Убедитесь, что TypeScript компилятор настроен правильно
3. Создайте сцены:
   - `MenuScene` - меню с настройками игры
   - `GameScene` - игровая сцена

### 4. Создание UI в Cocos Creator

#### MenuScene:
- Кнопка "Авторизация"
- Кнопка "Поиск матча"
- Dropdown для выбора режима (подкидной/переводной)
- Dropdown для выбора размера колоды (24/36)
- Dropdown для выбора количества игроков (2/3/4)
- Label для статуса

#### GameScene:
- Контейнер для карт в руке (`handContainer`)
- Контейнер для стола (`tableContainer`)
- Контейнер для информации об игроках (`playersContainer`)
- Контейнер для кнопок действий (`actionButtonsContainer`)
- Labels для информации (козырь, колода, фаза)
- Prefab для карты (`cardPrefab`)
- Prefab для карты на столе (`tableCardPrefab`)
- Prefab для информации об игроке (`playerInfoPrefab`)

## Использование

### Инициализация

Приложение автоматически инициализируется при загрузке сцены через `App.ts`:

```typescript
// Автоматическая авторизация через Telegram WebApp
if (window.Telegram?.WebApp?.initData) {
  facade.sendNotification(Notifications.AUTH_REQUEST);
}
```

### Авторизация

```typescript
// Ручная авторизация
facade.sendNotification(Notifications.AUTH_REQUEST, {
  initData: "your_telegram_init_data"
});
```

### Поиск матча

```typescript
facade.sendNotification(Notifications.MATCHMAKING_REQUEST, {
  config: {
    mode: "podkidnoy",
    deckSize: 36,
    maxPlayers: 2
  }
});
```

### Игровые действия

```typescript
// Атака
facade.sendNotification(Notifications.ATTACK_REQUEST, { card: "H9" });

// Защита
facade.sendNotification(Notifications.DEFEND_REQUEST, {
  attackIndex: 0,
  card: "H10"
});

// Перевод
facade.sendNotification(Notifications.TRANSFER_REQUEST, { card: "H9" });

// Взять
facade.sendNotification(Notifications.TAKE_REQUEST);

// Отбить
facade.sendNotification(Notifications.BEAT_REQUEST);

// Пасс
facade.sendNotification(Notifications.PASS_REQUEST);
```

## Архитектура PureMVC

### Proxy (Модель)
- **AuthProxy** - управление аутентификацией
- **GameProxy** - управление состоянием игры
- **WebSocketProxy** - управление WebSocket соединением

### Mediator (Представление)
- **MenuMediator** - управление меню
- **GameMediator** - управление игровой сценой
- **MessageMediator** - управление сообщениями

### Command (Контроллер)
- **StartupCommand** - инициализация приложения
- **AuthCommand** - обработка авторизации
- **MatchmakingCommand** - обработка поиска матча
- **WebSocketConnectCommand** - подключение к WebSocket
- **GameActionCommand** - обработка игровых действий

## Компоненты

### CardComponent
Визуальный компонент карты с поддержкой:
- Отображения масти и ранга
- Выделения козыря
- Выбора карты
- Анимаций

### PlayerInfoComponent
Компонент для отображения информации об игроке:
- Количество карт
- Индикатор атакующего/защищающегося
- Статус активности

## Утилиты

### CardUtils
Функции для работы с картами:
- `parseCard()` - парсинг карты
- `getCardDisplayName()` - получение отображаемого имени
- `isTrump()` - проверка козыря
- `cardBeats()` - проверка, бьет ли карта
- `sortCardsBySuitThenRank()` - сортировка карт

## Стилизация

Компоненты используют стандартные возможности Cocos Creator:
- Sprite для отображения карт
- Label для текста
- Button для интерактивных элементов
- Node для контейнеров

Для красивого дизайна рекомендуется:
- Использовать качественные спрайты карт
- Добавить анимации для действий
- Использовать эффекты частиц для важных событий
- Настроить звуковые эффекты

## Интеграция с Telegram WebApp

Приложение автоматически определяет наличие Telegram WebApp и использует его для авторизации:

```typescript
const initData = window.Telegram?.WebApp?.initData || "";
```

## Разработка

### Компиляция TypeScript

```bash
npm run build
```

### Режим разработки с автоперекомпиляцией

```bash
npm run dev
```

## Лицензия

MIT
