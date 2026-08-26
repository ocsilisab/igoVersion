import { useEffect, useState } from "react";
import { BOARD_SIZES, type AiDifficulty, type BoardSize, type ExtensionRules, type Player } from "../types/game";
import { DEFAULT_AI_DIFFICULTY, DEFAULT_KOMI, MAX_TOTAL_PLAYERS, NO_EXTENSIONS } from "../types/game";
import { checkNeuralServiceHealth } from "../ai/neural/chooseNeuralMove";
import KomiSelector from "./KomiSelector";
import PlayerRoster from "./PlayerRoster";
import ExtensionsSelector from "./ExtensionsSelector";
import "./GameSetup.css";

interface GameSetupProps {
  onStart: (
    boardSize: BoardSize,
    playerColor: Player,
    komi: number,
    humanNames: string[],
    extensions: ExtensionRules,
    difficulty: AiDifficulty
  ) => void;
  onCancel: () => void;
}

const MAX_HUMAN_PLAYERS = MAX_TOTAL_PLAYERS - 1; // the AI always takes one seat

const DIFFICULTIES: { value: AiDifficulty; label: string }[] = [
  { value: "facil", label: "Fácil" },
  { value: "dificil", label: "Difícil" },
  { value: "experta", label: "Experta" },
];

export default function GameSetup({ onStart, onCancel }: GameSetupProps) {
  const [boardSize, setBoardSize] = useState<BoardSize>(9);
  const [playerColor, setPlayerColor] = useState<Player>("black");
  const [komi, setKomi] = useState<number>(DEFAULT_KOMI);
  const [humanNames, setHumanNames] = useState<string[]>(["Jugador 1"]);
  const [extensions, setExtensions] = useState<ExtensionRules>(NO_EXTENSIONS);
  const [difficulty, setDifficulty] = useState<AiDifficulty>(DEFAULT_AI_DIFFICULTY);
  const [expertaStatus, setExpertaStatus] = useState<"checking" | "available" | "unavailable">("checking");
  const [nativeBoardSizes, setNativeBoardSizes] = useState<readonly BoardSize[]>([]);
  const [expertaCheckAttempt, setExpertaCheckAttempt] = useState(0);
  const expertaAvailable = expertaStatus === "available";

  useEffect(() => {
    let cancelled = false;
    setExpertaStatus("checking");
    // Can take up to ~50s on a cold Render instance — see checkNeuralServiceHealth's
    // default timeout — so the setup screen shows a "comprobando" state meanwhile instead
    // of immediately (and incorrectly) reporting "Experta" as unavailable.
    checkNeuralServiceHealth().then(({ available, nativeBoardSizes }) => {
      if (!cancelled) {
        setExpertaStatus(available ? "available" : "unavailable");
        setNativeBoardSizes(nativeBoardSizes);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [expertaCheckAttempt]);

  return (
    <div className="setup-screen">
      <div className="setup-content">
        <button className="link-button" onClick={onCancel}>
          ← Inicio
        </button>

        <h1 className="setup-title">Jugar con IA</h1>
        <p className="setup-subtitle">Configura la partida antes de empezar.</p>

        <section className="setup-section">
          <h2>Tamaño del tablero</h2>
          <div className="setup-options">
            {BOARD_SIZES.map((size) => (
              <button
                key={size}
                className={`setup-option ${boardSize === size ? "setup-option-active" : ""}`}
                onClick={() => setBoardSize(size)}
              >
                {size} × {size}
              </button>
            ))}
          </div>
        </section>

        <section className="setup-section">
          <h2>Tu equipo juega con</h2>
          <div className="setup-options">
            <button
              className={`setup-option ${playerColor === "black" ? "setup-option-active" : ""}`}
              onClick={() => setPlayerColor("black")}
            >
              <span className="stone-dot stone-dot-black" /> Negras
            </button>
            <button
              className={`setup-option ${playerColor === "white" ? "setup-option-active" : ""}`}
              onClick={() => setPlayerColor("white")}
            >
              <span className="stone-dot stone-dot-white" /> Blancas
            </button>
          </div>
          {playerColor === "white" && <p className="setup-hint">La IA (Negras) hará el primer movimiento.</p>}
        </section>

        <PlayerRoster
          title="Vuestro equipo (mismo dispositivo)"
          players={humanNames}
          onChange={setHumanNames}
          min={1}
          max={MAX_HUMAN_PLAYERS}
        />

        <section className="setup-section">
          <h2>Dificultad de la IA</h2>
          <div className="setup-options">
            {DIFFICULTIES.map((option) => {
              const disabled = option.value === "experta" && !expertaAvailable;
              const title =
                option.value === "experta" && expertaStatus === "checking"
                  ? "Comprobando disponibilidad del servicio de IA…"
                  : option.value === "experta" && expertaStatus === "unavailable"
                    ? "Servicio de IA neuronal no disponible ahora mismo."
                    : undefined;
              return (
                <button
                  key={option.value}
                  className={`setup-option ${difficulty === option.value ? "setup-option-active" : ""}`}
                  onClick={() => setDifficulty(option.value)}
                  disabled={disabled}
                  title={title}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="setup-hint">
            <strong>Fácil</strong>: reacciona a la jugada actual, sin planificar por delante. <strong>Difícil</strong>:
            explora varias jugadas futuras antes de decidir. <strong>Experta</strong>: red neuronal entrenada con
            partidas de jugadores profesionales.
          </p>
          {difficulty === "experta" && expertaStatus === "available" && !nativeBoardSizes.includes(boardSize) && (
            <p className="setup-hint">
              En {boardSize}×{boardSize} "Experta" usa el modelo de 19×19 adaptado a un tablero más pequeño — juega
              notablemente peor que en un tamaño para el que sí fue entrenada.
            </p>
          )}
          {expertaStatus === "checking" && (
            <p className="setup-hint">
              Comprobando si "Experta" está disponible… puede tardar hasta un minuto si el servicio llevaba un
              rato sin usarse.
            </p>
          )}
          {expertaStatus === "unavailable" && (
            <p className="setup-hint">
              "Experta" (red neuronal entrenada con partidas profesionales) no está disponible ahora mismo.{" "}
              <button className="link-button" onClick={() => setExpertaCheckAttempt((n) => n + 1)}>
                Reintentar
              </button>
            </p>
          )}
        </section>

        <KomiSelector komi={komi} onSelect={setKomi} />

        <ExtensionsSelector extensions={extensions} onChange={setExtensions} />

        <button
          className="btn btn-primary setup-start"
          onClick={() => onStart(boardSize, playerColor, komi, humanNames, extensions, difficulty)}
        >
          Empezar partida
        </button>
      </div>
    </div>
  );
}
