import { useState } from "react";
import type { BoardSize, Player } from "../types/game";
import { DEFAULT_KOMI } from "../types/game";
import { createOnlineGame, OnlineApiError } from "../online/api";
import KomiSelector from "./KomiSelector";
import "./GameSetup.css";

interface CreateOnlineGameProps {
  onCancel: () => void;
  onCreated: (gameId: string) => void;
}

const BOARD_SIZES: BoardSize[] = [9, 13, 19];

export default function CreateOnlineGame({ onCancel, onCreated }: CreateOnlineGameProps) {
  const [boardSize, setBoardSize] = useState<BoardSize>(9);
  const [creatorColor, setCreatorColor] = useState<Player>("black");
  const [komi, setKomi] = useState<number>(DEFAULT_KOMI);
  const [displayName, setDisplayName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const { game } = await createOnlineGame(boardSize, komi, creatorColor, displayName.trim() || undefined);
      onCreated(game.id);
    } catch (err) {
      setError(err instanceof OnlineApiError ? err.message : "No se ha podido crear la partida.");
      setIsCreating(false);
    }
  };

  return (
    <div className="setup-screen">
      <div className="setup-content">
        <button className="link-button" onClick={onCancel} disabled={isCreating}>
          ← Atrás
        </button>

        <h1 className="setup-title">Crear partida online</h1>
        <p className="setup-subtitle">Comparte el código con tu rival cuando la partida esté creada.</p>

        <section className="setup-section">
          <h2>Tamaño del tablero</h2>
          <div className="setup-options">
            {BOARD_SIZES.map((size) => (
              <button
                key={size}
                className={`setup-option ${boardSize === size ? "setup-option-active" : ""}`}
                onClick={() => setBoardSize(size)}
                disabled={isCreating}
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
              className={`setup-option ${creatorColor === "black" ? "setup-option-active" : ""}`}
              onClick={() => setCreatorColor("black")}
              disabled={isCreating}
            >
              <span className="stone-dot stone-dot-black" /> Negras
            </button>
            <button
              className={`setup-option ${creatorColor === "white" ? "setup-option-active" : ""}`}
              onClick={() => setCreatorColor("white")}
              disabled={isCreating}
            >
              <span className="stone-dot stone-dot-white" /> Blancas
            </button>
          </div>
        </section>

        <KomiSelector komi={komi} onSelect={setKomi} disabled={isCreating} />

        <section className="setup-section">
          <h2>Tu nombre (opcional)</h2>
          <input
            className="setup-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Invitado_XXXX"
            maxLength={24}
            disabled={isCreating}
          />
        </section>

        {error && <p className="error-banner">{error}</p>}

        <button className="btn btn-primary setup-start" onClick={handleCreate} disabled={isCreating}>
          {isCreating ? "Creando…" : "Crear partida"}
        </button>
      </div>
    </div>
  );
}
