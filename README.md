# Go (Igo)

Implementación web del juego de mesa japonés Go, hecha con React + TypeScript + Vite, con funciones serverless de Vercel (`/api`) para el modo online.

## Estado actual

- **Jugar solo**: totalmente funcional, dos jugadores locales en el mismo dispositivo.
- **Jugar con IA**: totalmente funcional, tres dificultades:
  - **Fácil**: heurística local basada en prioridades (sin backend).
  - **Difícil**: Monte Carlo Tree Search (MCTS) local con lookahead real (sin backend).
  - **Experta**: red neuronal (policy + value) entrenada, servida por `ai-service/` (Python/PyTorch/FastAPI) y desplegada en Render — solo disponible en tablero 19×19, y solo si ese servicio está accesible.
- **Jugar online**: funcional — requiere configurar Supabase (ver más abajo). Solo invitados por ahora; el registro está preparado pero deshabilitado (`REGISTRATION_ENABLED = false` en `src/online/types.ts`).
- **Cartas (Tesuji)**: modo aparte, 1v1 por turnos resolviendo problemas de vida/muerte contra el reloj; backend propio (`api/cards/*`) sobre la misma base de Supabase.

## Reglas implementadas (los tres modos)

- Colocación de piedras, turnos automáticos (Negras empiezan).
- Detección de grupos y libertades (conexión ortogonal).
- Capturas automáticas de grupos sin libertades, con contador por jugador.
- Prevención de movimientos suicidas.
- Regla básica de Ko (no repetir la posición de dos jugadas atrás).
- Pasar turno; dos pases consecutivos abren la fase de puntuación.
- Fase de puntuación: marcar piedras muertas (por grupo) antes de finalizar, con estimado en vivo.
- Puntuación final: piedras en tablero + territorio rodeado + capturas (incluidas las piedras muertas retiradas).
- Selector de tamaño de tablero (9×9, 13×13, 19×19).

## Arquitectura

```text
src/
├── components/      # UI: HomeScreen, GameScreen (solo), AiGameScreen, OnlineGameScreen,
│                     #     GoBoard, GameInfo, GameControls, GameSetup, CreateOnlineGame,
│                     #     CardsMenu, DeckBuilder, CardsPlay, modales…
├── hooks/
│   ├── useGoGame.ts     # estado y reglas — usado por "Jugar solo" y como base de "Jugar con IA"
│   ├── useAiGoGame.ts   # envuelve useGoGame añadiendo el turno automático de la IA
│   └── useCardGame.ts   # estado del modo Cartas (emparejamiento + partida)
├── ai/               # las tres dificultades: chooseMove.ts (Fácil), mcts/ (Difícil),
│                     #     neural/ (Experta — llama a ai-service/ por HTTP)
├── utils/            # lógica pura del juego: board, liberties, capture, ko, move, scoring, deadStones
├── cards/            # motor de reglas simplificado + catálogo de problemas para el modo Cartas
├── online/           # cliente de los modos online y cartas: types, api.ts/cardsApi.ts
│                     #     (fetch a /api/games|cards/*), supabaseClient.ts (Realtime),
│                     #     useOnlineGame.ts
└── types/game.ts

api/                  # funciones serverless de Vercel (Node) — fuente de verdad de online y cartas
├── games/
│   ├── index.ts          GET listar / POST crear partida
│   ├── join.ts            POST unirse por código
│   ├── cleanup.ts         POST mantenimiento (partidas y partidas de cartas expiradas/antiguas)
│   └── [id]/
│       ├── index.ts       GET estado actual / POST unirse, empezar, abandonar
│       ├── move.ts        POST colocar piedra
│       ├── pass.ts        POST pasar turno
│       ├── mark-dead.ts   POST marcar/desmarcar grupo muerto, o confirmar el marcador
│       └── finalize.ts    POST confirmar puntuación final (exige confirmación de ambos equipos)
├── cards/
│   ├── games/index.ts        POST crear / unirse a una partida de cartas por código
│   └── games/[id]/index.ts   GET estado / POST enviar baraja, responder, pedir revancha
└── _lib/              sesión de invitado, cliente Supabase (service role), rate limiting,
                        código de partida, acceso a datos con concurrencia optimista

ai-service/           # servicio Python (FastAPI + PyTorch) para "Experta": red policy+value,
                       #     MCTS con PUCT, dataset/entrenamiento/evaluación; desplegado como
                       #     contenedor Docker en Render (ver ai-service/render.yaml)

supabase/schema.sql   # esquema de la base de datos (tablas, RLS, funciones, Realtime)
```

La lógica de reglas de Go (`src/utils/`) es pura y sin dependencias de React ni de Node, así que tanto el hook local (`useGoGame`), la IA (`src/ai/`) como las funciones serverless (`api/games/[id]/move.ts`, etc.) importan y reutilizan exactamente las mismas funciones — las reglas no están duplicadas en ningún sitio. `ai-service/` reimplementa ese mismo motor de reglas por separado en Python (`ai-service/src/go_board.py` y afines), documentado como duplicación deliberada dado que corre en un runtime distinto.

## Modo online: por qué Supabase

El modo online necesita que el servidor sea la única fuente de verdad (el cliente nunca decide su propio color, capturas, turno, etc.) y que ambos navegadores vean los movimientos sin recargar. Con la app desplegada en Vercel como funciones serverless, un WebSocket propio no es viable (las funciones no mantienen conexiones persistentes). **Supabase** encaja bien porque:

- Postgres gestionado, con un esquema simple para la tabla `games` (ver `supabase/schema.sql`).
- **Realtime** integrado: el navegador se suscribe directamente a los cambios de la fila de su partida (sin gestionar nosotros ningún WebSocket), y también se usa para el indicador de conexión del rival (Presence).
- Row Level Security: el cliente solo puede **leer** partidas (`anon key`); todas las escrituras pasan por las funciones `/api/*`, que usan la `service_role key` (nunca expuesta al navegador).
- Plan gratuito suficiente para este proyecto.

### Variables de entorno necesarias

Ver `.env.example`. Tres variables:

| Variable | Dónde se usa | Secreta |
|---|---|---|
| `VITE_SUPABASE_URL` | Cliente (Realtime) y servidor | No |
| `VITE_SUPABASE_ANON_KEY` | Cliente (Realtime); RLS la limita a solo lectura | No (pero no la reutilices para nada con privilegios) |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo `/api/*` | **Sí** |
| `AUTH_SECRET` | Solo `/api/*` (firma la cookie de invitado, hash de IPs para rate limiting, token de `/api/games/cleanup`) | **Sí** |
| `VITE_AI_SERVICE_URL` | Cliente, solo para la dificultad "Experta" | No (URL pública del servicio en Render) |

### Pasos para configurarlo (debes hacerlos tú — no puedo crear la cuenta por ti)

1. Crea un proyecto gratuito en [supabase.com](https://supabase.com).
2. En el proyecto, abre **SQL Editor** → pega y ejecuta el contenido de `supabase/schema.sql`.
3. En **Project Settings → API**, copia:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (mantenla secreta)
4. Genera un secreto propio para `AUTH_SECRET`, por ejemplo: `openssl rand -hex 32`.
5. En el proyecto de Vercel: **Settings → Environment Variables**, añade las 4 variables anteriores (Production y Preview).
6. Vuelve a desplegar (los valores `VITE_*` se incrustan en el build del cliente, así que un cambio de variables requiere un nuevo deploy).

Sin estas variables configuradas, `Jugar solo` y `Jugar con IA` siguen funcionando con normalidad; `Jugar online` devolverá errores de servidor al crear/unirse a una partida.

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo (solo el front-end de Vite; /api no se ejecuta con `vite dev`)
npm run build    # build de producción (tsc de src/, api/ y vite.config.ts + vite build)
npm run lint     # oxlint
```

Para probar el modo online en local hace falta el runtime de Vercel (`vercel dev`), que sí sirve `/api` junto al front-end, con un archivo `.env` (copiado de `.env.example`) con credenciales reales de Supabase.
