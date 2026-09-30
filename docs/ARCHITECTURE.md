# Короны Пустоши: архитектура

Онлайн-стратегия в духе «Героев 3» для Pi Network. Играется в Pi Browser как веб-приложение.
Этот документ описывает, как устроен код и какие контракты связывают пакеты. Правила и баланс
взяты из играбельного прототипа `docs/prototype.html`; общий план игры в `docs/plan.md`.

## Пакеты (npm workspaces)

| Пакет | Что внутри | Запуск |
|---|---|---|
| `packages/shared` (`@korony/shared`) | Все правила игры на чистом TypeScript: данные, карта, герои, бой, ИИ, видимость, протокол. Никакого DOM, Node API, `Math.random`, `Date`. | Импортируется как исходники `.ts` |
| `packages/server` (`@korony/server`) | Node 22 + Express 5 + Colyseus 0.16. Вход через Pi, платежи Pi, магазин, онлайн-комнаты. Авторитетный: клиент шлёт только намерения. | `tsx src/index.ts` |
| `packages/client` (`@korony/client`) | Vite 7 + Phaser 3.90. Экраны карты и боя на Phaser, панели на DOM. Режим против ИИ работает прямо в браузере на `@korony/shared`. | `vite` |

Версии зафиксированы точно в `package.json` каждого пакета. TypeScript 5.9, `strict`,
`noUncheckedIndexedAccess`, `verbatimModuleSyntax` (импорт типов только через `import type`).

## Главные принципы

1. **Детерминизм.** Весь случайный выбор в `shared` идёт через `Rng` из `rng.ts` (mulberry32),
   состояние генератора хранится в `GameState.rngState`, поэтому одна и та же последовательность
   действий с одним `seed` даёт одно и то же состояние. Это нужно для реплеев, тестов и проверки читов.
2. **Состояние это простой JSON.** `GameState` сериализуется `JSON.stringify` без потерь
   (никаких `Map`, `Set`, классов, функций, `undefined` в массивах). Сервер хранит его и шлёт
   клиентам урезанный вид.
3. **Сервер авторитетный.** Клиент отправляет `GameAction`, сервер вызывает `applyAction`
   и рассылает каждому игроку `playerView` (туман войны вырезан на сервере).
4. **Одни и те же правила везде.** Режим против ИИ в браузере и онлайн-матч на сервере
   используют один и тот же `applyAction` и один и тот же ИИ.

## `@korony/shared`: модули и публичный API

Всё публичное реэкспортируется из `src/index.ts`. Ниже контракт, на который опираются сервер и клиент.
Имена и формы типов менять нельзя без обновления этого документа.

### `rng.ts`
```ts
export interface Rng { next(): number /* [0,1) */; int(min: number, max: number): number /* включительно */; pick<T>(arr: readonly T[]): T; readonly state: number }
export function createRng(state: number): Rng   // mulberry32; state это uint32
```

### Данные (`data/*.ts`)
```ts
export type Faction = "castle" | "necropolis" | "neutral";
export type UnitId = "pike" | "halberd" | "archer" | "marksman" | "griffin" | "royalGriffin"
                   | "skeleton" | "ghost" | "lich" | "wolf";
export interface UnitDef {
  id: UnitId; name: string /* ru */; faction: Faction; tier: number;
  hp: number; atk: number; def: number; dmg: [number, number]; spd: number; cost: number;
  shots?: number; fly?: boolean;
  upgradesTo?: UnitId; upgradeCost?: number; upgraded?: boolean;
  antiFly?: boolean;     // +50% урона летающим
  unlimRetal?: boolean;  // отвечает на каждую атаку
  noRetal?: boolean;     // атакованный не отвечает
  splash?: boolean;      // задевает врагов рядом с целью половиной урона
  ability?: string;      // описание способности по-русски
}
export const UNITS: Record<UnitId, UnitDef>;

export type SlotId = "head" | "neck" | "shoulders" | "torso" | "cloak" | "feet" | "weapon" | "shield" | "ring1" | "ring2";
export type StatKey = "atk" | "def" | "pow" | "move" | "spd" | "luck" | "morale" | "dmgPct" | "boltX";
export type ArtifactId = "sword" | "shield" | "rookieMail" | "apprenticeRing" | "boots" | "windCloak" | "luckAmulet"
  | "valorPauldrons" | "mageRing" | "crown" | "ashHelm" | "ashMail" | "ashBlade" | "stormOrb";
export interface ArtifactDef { id: ArtifactId; name: string; slot: Exclude<SlotId, "ring1" | "ring2"> | "ring";
  rarity: 0 | 1 | 2 | 3; set?: "ash"; fx: Partial<Record<StatKey, number>>; desc?: string }
export const ARTIFACTS: Record<ArtifactId, ArtifactDef>;
export const SLOTS: readonly { id: SlotId; name: string }[];
export const RARITY_NAMES: readonly string[];            // ["обычный","редкий","эпический","легендарный"]
export const SETS: Record<"ash", { name: string; need: number; fx: Partial<Record<StatKey, number>>; desc: string }>;
export const DROP_POOL: readonly ArtifactId[];          // что может выпасть из монстров

export type BuildingId = "griffinTower" | "mageGuild" | "forge";
export const BUILDINGS: Record<BuildingId, { id: BuildingId; name: string; cost: number; desc: string }>;

export type SpellId = "bolt" | "heal" | "haste";
export const SPELLS: Record<SpellId, { id: SpellId; name: string; target: "enemy" | "ally"; requires?: BuildingId; desc: string }>;

export type SkillId = "offense" | "armor" | "sorcery" | "pathfinding" | "luck" | "leadership";
export const SKILLS: Record<SkillId, { id: SkillId; name: string; stat: StatKey; amount: number }>;

export type QuestId = "chest" | "mine" | "fight" | "artifact" | "build" | "upgrade" | "level3" | "conquer";
export const QUESTS: readonly { id: QuestId; name: string; gold: number; exp: number }[];

export interface ShopItem { id: string; name: string; desc: string; pricePi: number;
  kind: "cosmetic" | "premium" | "loadout"; grants: { banner?: string; premiumDays?: number; startArtifact?: ArtifactId; startGold?: number } }
export const SHOP_ITEMS: readonly ShopItem[];            // цены в Pi; сервер берёт цену только отсюда
```
Баланс юнитов, артефактов, построек, заклинаний, навыков и заданий переносится из `docs/prototype.html`
(там объекты `U`, `ART`, `SET`, `BUILD`, `UPG`, `SKILLS`, `QUESTS`). Прирост за неделю для замка:
копейщики 10, лучники 6, грифоны 3 (если есть башня); для некрополя скелеты 12, призраки 5, личи 2 со 2-й недели (стартовый запас 8/3/0).

### Карты (`maps.ts`)
```ts
export type Terrain = "." | "F" | "M" | "W";            // равнина (проходима), лес, горы, вода
export interface MapObjectDef { kind: "castle" | "mine" | "chest" | "artifact" | "monster";
  x: number; y: number; owner?: 0 | 1; artifact?: ArtifactId; army?: ArmyStack[]; garrison?: ArmyStack[] }
export interface MapDef { id: string; name: string; cols: number; rows: number; terrain: string[];
  starts: { hero: { x: number; y: number }; castleIndex: number;
            faction?: Faction; heroName?: string; army?: ArmyStack[]; equipped?: Partial<Record<SlotId, ArtifactId>>; gold?: number }[];
  objects: MapObjectDef[] }   // недостающие поля старта берутся из SEAT_DEFAULTS (mapStart(map, seat))
export const MAPS: Record<string, MapDef>;               // минимум "valley" (карта прототипа 14×16, 2 игрока)
// mapgen.ts: id "random-s" | "random-m" | "random-l" (27², 39², 51²) — createGame строит карту из seed
// (generateMap, точечная симметрия для честности); resolveMap(mapId, seed), isKnownMapId(mapId).
```

### Состояние игры (`types.ts`, `game.ts`)
```ts
export type PlayerId = string;
export interface ArmyStack { unit: UnitId; count: number; countHint?: string /* только в PlayerView */ }
export interface Hero { id: string; owner: PlayerId; name: string; x: number; y: number; mp: number;
  level: number; exp: number; alive: boolean;
  base: Record<StatKey, number>;                         // atk, def, pow = 1; остальное 0
  equipped: Partial<Record<SlotId, ArtifactId>>; bag: ArtifactId[]; army: ArmyStack[] }
export interface MapObject { id: string; kind: MapObjectDef["kind"]; x: number; y: number; gone?: boolean;
  owner?: PlayerId | null; artifact?: ArtifactId; army?: ArmyStack[]; garrison?: ArmyStack[] }
export interface PlayerState { id: PlayerId; name: string; seat: 0 | 1; isAI: boolean;
  faction: Faction; gold: number; heroId: string; castleId: string;
  explored: string;                                      // строка cols*rows из "0"/"1"
  growth: Partial<Record<UnitId, number>>; built: Partial<Record<BuildingId, true>>; builtToday: boolean;
  quests: Partial<Record<QuestId, true>>; levelChoices: SkillId[][];   // очередь выборов навыка, по 2 варианта
  endedDay: boolean; defeated: boolean; banner?: string }
export interface GameState { version: 1; id: string; mapId: string; cols: number; rows: number; terrain: string[];
  day: number; rngState: number; players: PlayerState[]; heroes: Record<string, Hero>; objects: MapObject[];
  battles: ActiveBattle[]; winner: PlayerId | null; log: string[] }
export interface PlayerSetup { id: PlayerId; name: string; isAI: boolean;
  loadout?: { startArtifact?: ArtifactId; startGold?: number; banner?: string } }
export function createGame(opts: { id: string; mapId: string; seed: number; players: [PlayerSetup, PlayerSetup] }): GameState;
```
Игрок с `seat` 0 играет за замок (синие), `seat` 1 за некрополь (красные). В режиме против ИИ человек сидит на месте 0.

### Действия (`actions.ts`)
```ts
export type GameAction =
  | { type: "move"; to: { x: number; y: number } }      // сервер сам строит путь и идёт, пока хватает шагов
  | { type: "endDay" }
  | { type: "hire"; unit: UnitId }                       // нанять всех доступных, сколько хватает золота
  | { type: "build"; building: BuildingId }
  | { type: "upgrade"; unit: UnitId }                    // улучшить отряд героя, сколько хватает золота
  | { type: "equip"; artifact: ArtifactId }              // из рюкзака
  | { type: "unequip"; slot: SlotId }
  | { type: "chooseSkill"; index: 0 | 1 }
  | { type: "battle"; action: BattleAction }
  | { type: "autoBattle" };                              // ИИ доигрывает бой за этого игрока
export interface ActionResult { ok: boolean; error?: string; events: GameEvent[] }
export function applyAction(state: GameState, player: PlayerId, action: GameAction): ActionResult; // мутирует state, в game.ts
export function forceEndDay(state: GameState, player: PlayerId): ActionResult;  // для таймера сервера: ИИ доигрывает бои игрока и завершает его день
export function eventsForPlayer(state: GameState, player: PlayerId, events: GameEvent[]): GameEvent[]; // события без чужих тайн
export function findPath(state: GameState, heroId: string, to: { x: number; y: number }): { x: number; y: number }[];
```
`GameEvent` это размеченное объединение для анимаций и звуков на клиенте:
`{ type: "moved"; heroId; path }`, `{ type: "gold"; player; amount; reason }`, `{ type: "artifact"; player; artifact }`,
`{ type: "battleStart"; battleId; sides? }`, `{ type: "battle"; battleId; ev: BattleEvent }`, `{ type: "battleEnd"; battleId; winner: PlayerId | "neutral"; sides? }`,
`{ type: "level"; player }`, `{ type: "quest"; player; quest }`, `{ type: "newDay"; day }`, `{ type: "newWeek" }`,
`{ type: "mine"; player; objectId }`, `{ type: "defeat"; player }`, `{ type: "victory"; player }`, `{ type: "toast"; player?; text }`.

Правила хода: ходы одновременные. Пока у игрока идёт бой, он не может ходить по карте. Когда все люди нажали
`endDay`, выполняется `endOfDay`: ходы ИИ, доход (замок 1000, рудник 500), прирост в начале недели (каждые 7 дней),
сброс шагов и `builtToday`, `day++`. Сервер отвечает за таймер хода и может вызвать `endDay` за игрока.
Разбитый герой возвращается в замок игрока следующим утром с ополчением (REVIVE_ARMY). Потеря последнего замка
запускает отсчёт HOMELESS_DAYS (7 дней, `PlayerState.homelessSince`). Поражение: нет ни замка, ни живого героя,
или 7 дней без замка. Победа: у противника поражение. Каждый свой замок даёт 1000 золота в день и недельный прирост,
гарнизоны замков растут каждую неделю (GARRISON_WEEKLY), герой в своём замке сражается вместе с гарнизоном.
Уточнения, принятые при реализации: нападающий в бою всегда сторона 0; ход к цели заканчивается на клетке боя;
после конца дня игрок не может ходить, нанимать и строить, но может доигрывать бой и выбирать навык; цель хода
должна быть на исследованной клетке; задания и добыча артефактов с монстров только для людей; найм, постройка и
улучшение требуют, чтобы герой стоял в своём замке; не больше 5 отрядов в армии.

### Бой (`battle.ts`)
```ts
export interface BattleStack { id: number; unit: UnitId; side: 0 | 1; count: number; top: number /* hp верхнего */;
  startCount: number; c: number; r: number; shots: number; retal: boolean; defending: boolean; haste: boolean; moraled: boolean }
export interface Battle { id: string; cols: 8; rows: 11; rngState: number; round: number; stacks: BattleStack[];
  obstacles: [number, number][]; queue: number[]; active: number | null; spellUsed: [boolean, boolean];
  heroes: [BattleHero | null, BattleHero | null]; over: boolean; winnerSide: 0 | 1 | null }
export interface BattleHero { heroId: string; name: string; stats: Record<StatKey, number>; spells: SpellId[] }
export interface ActiveBattle { battle: Battle; sides: [PlayerId | "neutral", PlayerId | "neutral"];
  auto?: [boolean, boolean];   // сторона играет автоматически (ИИ, нейтралы, autoBattle)
  context: { kind: "monster" | "hero" | "garrison"; objectId?: string; heroIds: string[] } }
// Battle.id строится только из открытых данных: `b${day}-${heroId}-${objectId|heroId}`. Расстановка камней от
// открытого layoutSeed, а зерно костей боя берётся из скрытого генератора игры и никуда не отдаётся.
export type BattleAction =
  | { type: "move"; to: [number, number] }
  | { type: "attack"; target: number; from?: [number, number] }  // ближний бой, from = клетка, с которой бить
  | { type: "shoot"; target: number }
  | { type: "defend" }
  | { type: "cast"; spell: SpellId; target: number };            // не заканчивает ход отряда, 1 раз за раунд
export type BattleEvent =
  | { type: "move"; stack: number; to: [number, number] } | { type: "damage"; stack: number; amount: number; killed: number; lucky?: boolean; source: "melee" | "shot" | "retaliation" | "splash" | "spell" }
  | { type: "heal"; stack: number; revived: number } | { type: "haste"; stack: number } | { type: "morale"; stack: number }
  | { type: "death"; stack: number } | { type: "turn"; stack: number } | { type: "round"; round: number } | { type: "end"; winnerSide: 0 | 1 };
export function createBattle(opts: { id: string; seed: number; armies: [ArmyStack[], ArmyStack[]]; heroes: [BattleHero | null, BattleHero | null] }): Battle;
export function reachable(b: Battle, stackId: number): Record<string, number>;     // ключ "c,r" -> шагов
export function canShoot(b: Battle, stackId: number): boolean;
export function previewAttack(b: Battle, attacker: number, target: number, ranged: boolean): { minDmg: number; maxDmg: number; minKill: number; maxKill: number };
export function applyBattleAction(b: Battle, action: BattleAction): { ok: boolean; error?: string; events: BattleEvent[] }; // за активный отряд
export function chooseAiBattleAction(b: Battle): BattleAction;                           // для активного отряда
export function autoResolve(b: Battle): BattleEvent[];                                   // доиграть бой за обе стороны
export function applyAiBattleAction(b: Battle): { ok: boolean; events: BattleEvent[] };  // ход ИИ, включая «стоять на месте»
```
Формула урона, удача (шанс удачи*10% на x2), мораль (шанс мораль*10% на повторный ход раз в раунд),
способности, заклинания (молния `(15+15*магия)*(1+boltX)`, лечение `20+20*магия` с подъёмом павших до
начальной численности, ускорение +2 к скорости до конца раунда) такие же, как в прототипе.

### Видимость (`view.ts`)
```ts
export interface PlayerView { you: PlayerId; state: GameState }   // копия, где скрыто то, чего игрок не видит
export function playerView(state: GameState, player: PlayerId): PlayerView;
```
Скрывается: объекты и чужие герои на неисследованных клетках удаляются из копии (у противника `heroId`/`castleId`
могут указывать на отсутствующее), точная численность чужих армий, монстров и гарнизонов (`count: 0` и `countHint`),
золото, рюкзак, прирост, задания, выборы навыков и карта исследования противника, `rngState` игры и боёв (0),
бои, в которых игрок не участвует. Ограничение: стартовые размеры монстров открыты, потому что `MAPS` есть в клиенте.
Генератор 32-битный, поэтому теоретически зерно можно подобрать по наблюдаемым броскам; усилить позже секретом на сервере.

### Протокол (`protocol.ts`)
```ts
export type ClientMessage = { t: "action"; action: GameAction; seq: number };
export type ServerMessage =
  | { t: "view"; view: PlayerView; events: GameEvent[]; ackSeq?: number }
  | { t: "error"; message: string; ackSeq?: number }
  | { t: "timer"; endsAt: number };                       // конец дня по таймеру, unix ms
export interface RoomJoinOptions { token: string; mode: "pvp"; mapId?: string; code?: string /* 1..16 символов */ }
export const ROOM_NAME = "match";
export interface AuthResponse { token: string; user: { uid: string; username: string; premiumUntil: number | null; banner: string | null; owned: string[] } }
```

### Сезонная Пустошь (`world.ts`)
Общая карта сезона для всех игроков. Состояние `WorldState` тоже простой JSON, время приходит снаружи как `now` (мс),
случайность из `WorldState.rngState`.
```ts
export const WORLD_LAYOUT: readonly string[];   // 9×9: "." пустошь, m шахта, r руины, z зона заражения, f форт, C Цитадель
export function createWorld(opts: { seed: number; now: number; season?: number; dayMs?: number; seasonDays?: number }): WorldState;
export function advanceWorld(state: WorldState, now: number): number;   // прошедшие дни: доход, рост охраны, наём, рейдеры, боссы и тайники, конец сезона
export function applyWorldAction(state: WorldState, actor: { id: PlayerId; name: string }, action: WorldAction, now: number): WorldResult;
export function worldView(state: WorldState, playerId: PlayerId | null, now: number): WorldView;   // чужие гарнизоны только приблизительно
export type WorldAction = join | attack | hire | reinforce | withdraw | createClan | joinClan | leaveClan | donate | fortify;
```
Бой на общей карте это обычный тактический бой, который ИИ доигрывает за обе стороны (`autoResolve`), поэтому игрок вне сети
защищается оставленными гарнизонами. Три клана рейдеров (боты) держат часть земли и растут до `BOT_MAX_SECTORS`, но не
отнимают землю у людей. Клан, удержавший Цитадель к концу сезона, попадает в зал славы; игроки и кланы переходят в новый сезон.

## Сервер

- `POST /api/auth/pi` `{ accessToken }` проверяет токен запросом `GET {PI_API_BASE}/v2/me` с заголовком
  `Authorization: Bearer <accessToken>`, заводит или находит пользователя по `uid`, выдаёт свой токен сессии (JWT HS256, `jose`, 7 дней).
- `POST /api/auth/guest` `{ username }`: гостевой вход для обычного браузера. Включён по умолчанию (`ALLOW_GUEST_LOGIN`),
  перед подачей в Pi Mainnet выключается (`ALLOW_GUEST_LOGIN=false`, тогда 404 `guest_login_disabled`). Каждый вход создаёт
  новый аккаунт `guest:<случайный id>`, имя только отображается, поэтому чужого гостя по имени не занять. Гостям платежи
  закрыты (403 `pi_login_required`).
- `GET /api/me` данные пользователя и покупки. `GET /api/shop` каталог `SHOP_ITEMS`.
- Платежи (U2A), всё с `Authorization: Bearer <сессия>`:
  - `POST /api/payments/approve` `{ paymentId }`: `GET /v2/payments/{id}` с `Authorization: Key <PI_API_KEY>`, проверить,
    что `user_uid` совпадает с пользователем сессии, `metadata.itemId` есть в каталоге и `amount` равен цене; записать
    платёж как `approved`; `POST /v2/payments/{id}/approve`.
  - `POST /api/payments/complete` `{ paymentId, txid }`: снова получить платёж, проверить `transaction.txid === txid`
    и `status.transaction_verified`, `POST /v2/payments/{id}/complete` с `{ txid }`, выдать товар. Идемпотентно: второй вызов ничего не выдаёт повторно.
  - `POST /api/payments/incomplete` `{ payment }`: для `onIncompletePaymentFound`, довести платёж до конца или отменить.
- Хранилище за интерфейсом `Store` (пользователи, покупки, платежи). Сейчас `MemoryStore`; PostgreSQL следующим шагом.
- Сезонная Пустошь: `GET /api/world` (вид мира для игрока) и `POST /api/world/action` `{ action }` → `{ result, view }`.
  Нарушение правил приходит как `result.ok = false`, ошибка формата как 400. Мир один на сервер (`WorldService`), хранится
  в памяти и сохраняется снимком через 2 секунды после изменения: в Upstash Redis по REST (`UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`), иначе в файл `WORLD_FILE`, иначе нигде. Длина дня и сезона: `WORLD_DAY_MINUTES` (1440), `WORLD_SEASON_DAYS` (28).
- Colyseus-комната `match` (2 игрока, PvP): `onAuth` проверяет токен сессии, `onJoin` сажает игрока, при двух игроках
  `createGame` с покупками (`loadout`), `onMessage("action")` проверяет сообщение `isClientMessage`, вызывает `applyAction`
  и шлёт каждому игроку `{ t: "view", view: playerView(state, p), events: eventsForPlayer(state, p, result.events) }`.
  По таймеру дня сервер вызывает `forceEndDay` за тех, кто не закончил.
  Переподключение 60 секунд, таймер дня 90 секунд. Игроки встречаются только с тем же кодом друга и картой
  (`filterBy(["code", "mapId"])`, пустой код значит быструю игру). Игроки в комнате `p0` и `p1` по местам.
  Уход с согласием (`leave(true)`, кнопка «Сдаться») засчитывается как поражение; обрыв связи ждёт переподключения,
  а после него тоже поражение. Остановка сервера никому не засчитывается.
  WebSocket через `@colyseus/ws-transport` на том же HTTP-сервере, что и REST; собранный клиент отдаётся тем же процессом.

## Клиент

- `index.html` подключает `https://sdk.minepi.com/pi-sdk.js`. `src/pi.ts` оборачивает `window.Pi`: `init({ version: "2.0", sandbox })`,
  `authenticate(["username","payments"], onIncompletePaymentFound)`, покупки через `createPayment` и серверные эндпоинты.
  Pi Browser узнаётся по `PiBrowser/<версия>` в user agent (или песочница Developer Portal в рамке при `VITE_PI_SANDBOX=true`).
  Только там SDK инициализируется и показывается вход через Pi. В обычном браузере сразу показывается вход гостем по имени
  (имя запоминается) и игра против ИИ без входа.
- `GameConnection`: `LocalGame` (против ИИ, движок в браузере, сохранение в `localStorage`) и `OnlineGame` (Colyseus).
  Оба отдают `PlayerView` и события, экраны не знают, откуда пришло состояние.
- Phaser-сцены: `MapScene` (тайлы, объекты, герои, туман, путь по двойному нажатию), `BattleScene` (гексы, анимации, всплывающий урон).
  Панели (герой, замок, задания, магия, навыки, лавка, лобби) на DOM поверх канваса. Графика рисуется кодом, как в прототипе, пока нет спрайтов.
- Строки интерфейса через `src/i18n` (русский по умолчанию, английский), чтобы добавлять языки сообществ Pi.
- Звук на WebAudio, как в прототипе, с переключателями.

## Проверки

`npm run check` в корне: typecheck всех пакетов, `vitest` во всех пакетах, `vite build` клиента. Это же запускает CI.
