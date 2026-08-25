import { useState } from "react";
import { useCardGame } from "../hooks/useCardGame";
import "./GameSetup.css";
import "./OnlineGameScreen.css";

interface CardsPlayProps {
  onBack: () => void;
}

export default function CardsPlay({ onBack }: CardsPlayProps) {
  const { game, isHost, loading, error, joinByCode, clearError } = useCardGame();
  const [codeInput, setCodeInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [joining, setJoining] = useState(false);

  const handleCopyCode = async () => {
    if (!game) return;
    try {
      await navigator.clipboard.writeText(game.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied/unavailable — the code is still visible on screen.
    }
  };

  const handleJoin = async () => {
    if (!codeInput.trim()) return;
    setJoining(true);
    clearError();
    await joinByCode(codeInput.trim());
    setJoining(false);
  };

  if (loading) {
    return (
      <div className="online-status-screen">
        <p>Preparando partida…</p>
      </div>
    );
  }

  const opponentName = game && (isHost ? game.guestName : game.hostName);
  const yourName = game && (isHost ? game.hostName : game.guestName);
  const connected = game?.status === "ready";

  return (
    <div className="online-status-screen">
      <button className="link-button" onClick={onBack}>
        ← Cartas
      </button>

      <h1 className="setup-title">Jugar</h1>

      {connected ? (
        <>
          <p>
            Conectado con <strong>{opponentName}</strong>.
          </p>
          <p className="online-waiting">El juego de cartas está en construcción — pronto podréis jugar de verdad.</p>
        </>
      ) : (
        <>
          <p className="setup-subtitle">
            Comparte tu código con la otra persona, o introduce el suyo si ya te lo ha pasado.
          </p>

          {game && (
            <div className="online-code-card">
              <span className="online-code-label">Tu código</span>
              <span className="online-code-value">{game.code}</span>
              <div className="online-code-actions">
                <button className="btn btn-secondary" onClick={() => void handleCopyCode()}>
                  {copied ? "¡Copiado!" : "Copiar código"}
                </button>
              </div>
            </div>
          )}

          {game && <p className="online-waiting">Esperando a que se una la otra persona…</p>}

          <div className="online-join-panel">
            <input
              className="setup-input"
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Código del rival"
              maxLength={6}
              disabled={joining}
            />
            <button className="btn btn-primary" onClick={() => void handleJoin()} disabled={joining || !codeInput.trim()}>
              {joining ? "Uniendo…" : "Jugar"}
            </button>
          </div>
        </>
      )}

      {error && <p className="error-banner">{error}</p>}

      {!connected && yourName && <p className="online-waiting">Tú: {yourName}</p>}
    </div>
  );
}
