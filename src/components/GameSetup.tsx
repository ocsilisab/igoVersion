import { useState } from "react";
import type { BoardSize, Player } from "../types/game";
import "./GameSetup.css";

interface GameSetupProps {
  onStart: (boardSize: BoardSize, playerColor: Player) => void;
  onCancel: () => void;
}

const BOARD_SIZES: BoardSize[] = [9, 13, 19];

export default function GameSetup({ onStart, onCancel }: GameSetupProps) {
  const [boardSize, setBoardSize] = useState<BoardSize>(9);
  const [playerColor, setPlayerColor] = useState<Player>("black");

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
          <h2>Tu color</h2>
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

        <button className="btn btn-primary setup-start" onClick={() => onStart(boardSize, playerColor)}>
          Empezar partida
        </button>
      </div>
    </div>
  );
}
