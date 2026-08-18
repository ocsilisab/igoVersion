import { useState } from "react";
import { joinOnlineGame, OnlineApiError } from "../online/api";
import "./GameSetup.css";

interface JoinOnlineGameProps {
  onCancel: () => void;
  onJoined: (gameId: string) => void;
}

export default function JoinOnlineGame({ onCancel, onJoined }: JoinOnlineGameProps) {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    if (code.trim().length === 0) return;
    setIsJoining(true);
    setError(null);
    try {
      const { game } = await joinOnlineGame(code, displayName.trim() || undefined);
      onJoined(game.id);
    } catch (err) {
      setError(err instanceof OnlineApiError ? err.message : "No se ha podido unir a la partida.");
      setIsJoining(false);
    }
  };

  return (
    <div className="setup-screen">
      <div className="setup-content">
        <button className="link-button" onClick={onCancel} disabled={isJoining}>
          ← Atrás
        </button>

        <h1 className="setup-title">Unirse a partida</h1>
        <p className="setup-subtitle">Tú jugarás con blancas. Introduce el código que te ha compartido tu rival.</p>

        <section className="setup-section">
          <h2>Código de partida</h2>
          <input
            className="setup-input setup-input-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="AB7K92"
            maxLength={6}
            disabled={isJoining}
            autoCapitalize="characters"
            autoComplete="off"
          />
        </section>

        <section className="setup-section">
          <h2>Tu nombre (opcional)</h2>
          <input
            className="setup-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Invitado_XXXX"
            maxLength={24}
            disabled={isJoining}
          />
        </section>

        {error && <p className="error-banner">{error}</p>}

        <button
          className="btn btn-primary setup-start"
          onClick={handleJoin}
          disabled={isJoining || code.trim().length === 0}
        >
          {isJoining ? "Uniéndose…" : "Unirse"}
        </button>
      </div>
    </div>
  );
}
