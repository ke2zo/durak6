# Быстрый старт

## 1. Установка зависимостей

```bash
cd client
npm install
```

## 2. Настройка API URL

Откройте `assets/scripts/config/GameConfig.ts` и установите URL вашего Cloudflare Worker:

```typescript
static API_BASE_URL: string = "https://your-worker.workers.dev";
```

Или установите через глобальную переменную перед запуском:

```typescript
window.GAME_CONFIG = {
  API_BASE_URL: "https://your-worker.workers.dev"
};
```

## 3. Настройка Cocos Creator

1. Откройте проект в Cocos Creator
2. Создайте сцену `MenuScene`:
   - Добавьте узел с компонентом `MenuMediator`
   - Добавьте кнопки и dropdown'ы согласно описанию в README
3. Создайте сцену `GameScene`:
   - Добавьте узел с компонентом `GameMediator`
   - Настройте контейнеры для карт, стола, игроков
   - Создайте prefab'ы для карт и информации об игроках
4. Создайте главную сцену с компонентом `App`

## 4. Создание Prefab'ов

### Card Prefab
1. Создайте новый Node
2. Добавьте компонент `CardComponent`
3. Добавьте Sprite для фона карты
4. Добавьте Label для ранга и масти
5. Добавьте Button для интерактивности
6. Сохраните как Prefab

### Table Card Prefab
Аналогично Card Prefab, но без Button (только отображение)

### Player Info Prefab
1. Создайте Node с компонентом `PlayerInfoComponent`
2. Добавьте Labels для имени и количества карт
3. Добавьте индикаторы для атакующего/защищающегося

## 5. Запуск

1. Запустите Cocos Creator
2. Откройте главную сцену
3. Нажмите "Play"

## 6. Тестирование

### Без Telegram WebApp
Для тестирования без Telegram можно модифицировать `AuthProxy.ts`:

```typescript
async authenticateWithTelegram(): Promise<void> {
  // Для тестирования используйте фиктивные данные
  const testInitData = "user=%7B%22id%22%3A123%7D&hash=test";
  await this.authenticate(testInitData);
}
```

### С Telegram WebApp
1. Разверните приложение на сервере
2. Откройте через Telegram Bot
3. Авторизация произойдет автоматически

## Структура сцен

### MenuScene
```
Canvas
├── MenuPanel
│   ├── AuthButton (Button)
│   ├── MatchmakingButton (Button)
│   ├── ModeDropdown (Dropdown)
│   ├── DeckSizeDropdown (Dropdown)
│   ├── PlayersDropdown (Dropdown)
│   └── StatusLabel (Label)
└── MenuMediator (Component)
```

### GameScene
```
Canvas
├── GamePanel
│   ├── HandContainer (Node)
│   ├── TableContainer (Node)
│   ├── PlayersContainer (Node)
│   ├── ActionButtonsContainer (Node)
│   │   ├── AttackButton
│   │   ├── DefendButton
│   │   ├── TransferButton
│   │   ├── TakeButton
│   │   ├── BeatButton
│   │   └── PassButton
│   ├── TrumpLabel (Label)
│   ├── DeckCountLabel (Label)
│   └── PhaseLabel (Label)
└── GameMediator (Component)
```

## Следующие шаги

1. Добавьте красивые спрайты для карт
2. Настройте анимации для действий
3. Добавьте звуковые эффекты
4. Настройте UI/UX дизайн
5. Оптимизируйте производительность
