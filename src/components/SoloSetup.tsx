import { useState } from "react";
import type { BoardSize } from "../types/game";
import { DEFAULT_KOMI } from "../types/game";
import KomiSelector from "./KomiSelector";
import "./GameSetup.css";

interface SoloSetupProps {
  onStart: (boardSize: BoardSize, komi: number) => void;
  onCancel: () => void;
}

const BOARD_SIZES: BoardSize[] = [9, 13, 19];

export default function SoloSetup({ onStart, onCancel }: SoloSetupProps) {
  const [boardSize, setBoardSize] = useState<BoardSize>(9);
  const [komi, setKomi] = useState<number>(DEFAULT_KOMI);

  return (
    <div className="setup-screen">
      <div className="setup-content">
        <button className="link-button" onClick={onCancel}>
          ← Inicio
        </button>

        <h1 className="setup-title">Jugar solo</h1>
        <p className="setup-subtitle">Configura la partida antes de empezar. Dos jugadores, mismo dispositivo.</p>

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

        <KomiSelector komi={komi} onSelect={setKomi} />

        <button className="btn btn-primary setup-start" onClick={() => onStart(boardSize, komi)}>
          Empezar partida
        </button>
      </div>
    </div>
  );
}
