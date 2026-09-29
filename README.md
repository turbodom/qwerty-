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

## Вход

- В обычном браузере (Chrome, Safari и другие) игра предлагает вход гостем по имени. Гостю доступны игра против ИИ и онлайн-партии, покупки за Pi нет.
- В Pi Browser игра входит через Pi SDK, покупки идут через Pi.
- Гостевой вход включён по умолчанию, в том числе на боевом сервере. Перед подачей в Pi Mainnet его нужно выключить: `ALLOW_GUEST_LOGIN=false`, потому что Pi разрешает только вход через Pi.

## Запуск на сервере

```bash
npm install
npm run build                                   # собирает клиент в packages/client/dist
NODE_ENV=production SESSION_SECRET=<32+ символов> npm start -w @korony/server
```

Сервер сам отдаёт собранный клиент, игра открывается на `http://<сервер>:2567`.

## Проверки

```bash
npm run check               # типы, тесты и сборка клиента
```
