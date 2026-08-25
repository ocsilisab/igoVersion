import { RANK_LEVELS, type TesujiCard } from "./types.js";

/**
 * Real named Go tesuji (tactical techniques), Spanish name with the Japanese term. Each
 * one appears on multiple cards at different rank levels (see ALL_TESUJI_CARDS below) --
 * the same technique gets harder to spot and apply correctly the stronger the level, so
 * one name legitimately spans the whole kyu/dan range rather than being tied to a single
 * rank.
 */
const TESUJI_POOL: { name: string; description: string }[] = [
  { name: "Atari (amenaza de captura)", description: "Dejar a un grupo rival con una sola libertad, amenazando capturarlo en la siguiente jugada." },
  { name: "Escalera (Shicho)", description: "Persecución en zigzag que empuja un grupo hacia el borde del tablero hasta capturarlo, si no hay ninguna piedra que la rompa." },
  { name: "Red (Geta)", description: "Encierra un grupo en una red de piedras sin dejarle escapatoria, aunque le queden varias libertades." },
  { name: "Contacto (Tsuke)", description: "Jugar pegado a una piedra rival para probar su fuerza o iniciar un intercambio local." },
  { name: "Hane", description: "Rodear la esquina de una piedra o grupo rival en diagonal, ganando terreno con eficacia." },
  { name: "Extensión (Nobi)", description: "Alargar un grupo en línea recta para ganar libertades y reforzar su base." },
  { name: "Salto de caballo (Keima)", description: "Movimiento en forma de L que avanza rápido manteniendo cierta conexión con el grupo propio." },
  { name: "Salto grande (Ogeima)", description: "Una extensión más larga que el keima, arriesgada pero muy eficiente en espacio abierto." },
  { name: "Salto (Tobi)", description: "Avanzar dejando un espacio vacío entre la piedra nueva y la anterior, ganando terreno rápido." },
  { name: "Doble salto (Nikken Tobi)", description: "Dos espacios de salto en línea recta, típico para extender un grupo a lo largo del lateral." },
  { name: "Descenso (Sagari)", description: "Bajar una piedra hacia la primera o segunda línea para asegurar vida o territorio." },
  { name: "Empuje (Oshi)", description: "Jugar pegado y en la misma dirección que una piedra rival, empujándola hacia una zona menos favorable." },
  { name: "Corte (Kiri)", description: "Separar dos grupos rivales que aún no están conectados, forzando a defender uno de los dos." },
  { name: "Conexión (Tsugi)", description: "Unir dos grupos propios en uno solo, eliminando el punto de corte entre ellos." },
  { name: "Sacrificio (Sute-ishi)", description: "Ceder deliberadamente una o varias piedras a cambio de una ventaja mayor en otra parte." },
  { name: "Recaptura instantánea (Utte-gaeshi)", description: "Dejar capturar una piedra a propósito para recapturar de inmediato un grupo mayor." },
  { name: "Aprieto (Shibori)", description: "Forzar al rival a jugar piedras que luego quedarán mal colocadas, mejorando la propia forma." },
  { name: "Cuña (Warikomi)", description: "Colarse entre dos piedras rivales para romper su conexión antes de que se unan." },
  { name: "Pinza (Hasami)", description: "Atacar una piedra rival desde dos direcciones a la vez, limitando mucho su desarrollo." },
  { name: "Doble Hane", description: "Encadenar dos hane seguidos para ganar mucho más terreno del habitual, a cambio de crear debilidades." },
  { name: "Corte cruzado (Kiri-chigai)", description: "Cortar en dos puntos a la vez, generando una pelea confusa donde ambos bandos tienen grupos débiles." },
  { name: "Codo (Kosumi)", description: "Jugar en diagonal justo al lado de una piedra propia, una conexión fuerte y difícil de cortar." },
  { name: "Vientre del hane (Hara-hane)", description: "Un hane jugado un paso más lejos de lo habitual, apuntando al centro del grupo rival." },
  { name: "Punto vital (Kyusho)", description: "El punto que decide la vida o la muerte de un grupo, o su forma, si se juega a tiempo." },
  { name: "Robo de ojo (Me-ubai)", description: "Jugar en el punto que impediría al rival formar un segundo ojo, condenando su grupo." },
  { name: "Colocación (Oki)", description: "Dejar caer una piedra dentro del territorio rival sin apoyo inmediato, sembrando problemas para más tarde." },
  { name: "Puente (Watari)", description: "Conectar dos grupos propios pasando por debajo o alrededor de piedras rivales." },
  { name: "Tira y afloja (Hiki)", description: "Retirarse un paso en lugar de resistir, cediendo terreno para consolidar una posición más sólida." },
  { name: "Ataque doble (Ryoatari)", description: "Una sola jugada que pone en atari a dos grupos rivales distintos al mismo tiempo." },
  { name: "Sacrificio de dos piedras (Nidan Sute-ishi)", description: "Sacrificar dos piedras conectadas para dejar al rival con una forma ineficiente tras capturarlas." },
];

function generateAllTesujiCards(): TesujiCard[] {
  const cards: TesujiCard[] = [];
  const extraCardLevels = new Set(RANK_LEVELS.map((_, i) => i).filter((i) => i % 4 === 0));
  let cursor = 0;

  RANK_LEVELS.forEach((rank, levelIndex) => {
    const rankValue = levelIndex < 15 ? -(15 - levelIndex) : levelIndex - 14;
    const cardsInLevel = extraCardLevels.has(levelIndex) ? 7 : 6;

    for (let i = 0; i < cardsInLevel; i++) {
      const { name, description } = TESUJI_POOL[cursor % TESUJI_POOL.length];
      cards.push({ id: `tesuji-${cursor}`, name, description, rank, rankValue });
      cursor++;
    }
  });

  return cards;
}

/** All 150 tesuji cards the game defines, evenly spread across the 24 rank levels (6-7 per level). */
export const ALL_TESUJI_CARDS: TesujiCard[] = generateAllTesujiCards();
