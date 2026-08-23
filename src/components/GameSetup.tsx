import { useEffect, useState } from "react";
import type { AiDifficulty, BoardSize, ExtensionRules, Player } from "../types/game";
import { DEFAULT_AI_DIFFICULTY, DEFAULT_KOMI, MAX_TOTAL_PLAYERS, NO_EXTENSIONS } from "../types/game";
import { checkNeuralServiceHealth, NEURAL_AI_BOARD_SIZE } from "../ai/neural/chooseNeuralMove";
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

const BOARD_SIZES: BoardSize[] = [9, 13, 19];
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
  const [expertaCheckAttempt, setExpertaCheckAttempt] = useState(0);
  const expertaAvailable = expertaStatus === "available";

  useEffect(() => {
    let cancelled = false;
    setExpertaStatus("checking");
    // Can take up to ~50s on a cold Render instance — see checkNeuralServiceHealth's
    // default timeout — so the setup screen shows a "comprobando" state meanwhile instead
    // of immediately (and incorrectly) reporting "Experta" as unavailable.
    checkNeuralServiceHealth().then((available) => {
      if (!cancelled) setExpertaStatus(available ? "available" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [expertaCheckAttempt]);

  const handleBoardSizeChange = (size: BoardSize) => {
    setBoardSize(size);
    if (difficulty === "experta" && size !== NEURAL_AI_BOARD_SIZE) {
      setDifficulty(DEFAULT_AI_DIFFICULTY);
    }
  };

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
                onClick={() => handleBoardSizeChange(size)}
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
            {DIFFICULTIES.filter((option) => option.value !== "experta" || boardSize === NEURAL_AI_BOARD_SIZE).map(
              (option) => {
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
              }
            )}
          </div>
          {boardSize === NEURAL_AI_BOARD_SIZE && expertaStatus === "checking" && (
            <p className="setup-hint">
              Comprobando si "Experta" está disponible… puede tardar hasta un minuto si el servicio llevaba un
              rato sin usarse.
            </p>
          )}
          {boardSize === NEURAL_AI_BOARD_SIZE && expertaStatus === "unavailable" && (
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
