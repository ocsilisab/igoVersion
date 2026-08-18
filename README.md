# Go (Igo)

Implementación web del juego de mesa japonés Go, hecha con React + TypeScript + Vite.

## Estado actual

- **Jugar solo**: totalmente funcional, dos jugadores locales en el mismo dispositivo.
- **Jugar con IA** y **Jugar online**: pendientes ("Próximamente").

## Reglas implementadas

- Colocación de piedras, turnos automáticos (Negras empiezan).
- Detección de grupos y libertades (conexión ortogonal).
- Capturas automáticas de grupos sin libertades, con contador por jugador.
- Prevención de movimientos suicidas.
- Regla básica de Ko (no repetir la posición de dos jugadas atrás).
- Pasar turno; dos pases consecutivos terminan la partida.
- Puntuación al finalizar: piedras en tablero + territorio rodeado + capturas.
- Selector de tamaño de tablero (9×9, 13×13, 19×19) con confirmación si hay partida en curso.
- Reiniciar partida con confirmación.

## Arquitectura

```text
src/
├── components/     # UI (HomeScreen, GameScreen, GoBoard, GameInfo, GameControls, BoardSelector, modales)
├── hooks/
│   └── useGoGame.ts  # estado y orquestación de la partida
├── utils/          # lógica pura: board, liberties, capture, ko, scoring
├── types/
│   └── game.ts
└── App.tsx
```

La lógica del juego (utils/ y hooks/) está separada de los componentes visuales para poder añadir más adelante modos de IA y online sin reescribir el núcleo.

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # build de producción (incluye tsc)
npm run lint     # oxlint
```
