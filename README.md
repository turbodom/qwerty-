# Короны Пустоши

Онлайн-стратегия в духе «Героев 3» для Pi Network: карта приключений, замки, герои с артефактами, тактические бои на гексах, игра против ИИ и против живых игроков.

- Как устроен код: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- План игры и монетизации: [docs/plan.md](docs/plan.md)
- Играбельный прототип в одном файле: [docs/prototype.html](docs/prototype.html)

## Запуск для разработки

Нужен Node 22.

```bash
npm install
cp .env.example .env        # заполните SESSION_SECRET, для платежей PI_API_KEY
npm run dev:server          # сервер на http://localhost:2567
npm run dev:client          # клиент на http://localhost:5173
```

Вне Pi Browser работает вход разработчика (`ALLOW_DEV_LOGIN=true`). В Pi Browser игра входит через Pi SDK.

## Проверки

```bash
npm run check               # типы, тесты и сборка клиента
```
