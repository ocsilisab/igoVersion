import { useEffect, useRef, useState } from "react";
import { useCardGame } from "../hooks/useCardGame";
import { useClipboardCopy } from "../hooks/useClipboardCopy";
import { getOrCreateCollection, getSavedDeck } from "../cards/collection";
import CardsMatch from "./CardsMatch";
import "./GameSetup.css";
import "./OnlineGameScreen.css";

interface CardsPlayProps {
  onBack: () => void;
}

/** This player's chosen deck (up to 50 cards from DeckBuilder), or their whole owned
 * collection if they never built one -- so the match is still playable either way. */
function myDeckIds(): string[] {
  const collection = getOrCreateCollection();
  const ownedIds = new Set(collection.map((c) => c.id));
  const deck = getSavedDeck(ownedIds);
  return deck.size > 0 ? Array.from(deck) : Array.from(ownedIds);
}

export default function CardsPlay({ onBack }: CardsPlayProps) {
  const { game, isHost, loading, error, joinByCode, submitHand, submitAnswer, rematch, clearError } = useCardGame();
  const [codeInput, setCodeInput] = useState("");
  const { copiedKey, copy } = useClipboardCopy();
  const [joining, setJoining] = useState(false);
  // Guards against re-submitting a hand while the first submission is still in flight
  // (game.hostHand/guestHand is still null then too). Cleared on 'finished' so a rematch
  // -- which resets the same game id back to 'ready' -- can submit a fresh hand again.
  const handSubmittedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!game) return;
    if (game.status === "finished") {
      handSubmittedFor.current = null;
      return;
    }
    if (game.status !== "ready") return;
    const myHand = isHost ? game.hostHand : game.guestHand;
    if (myHand || handSubmittedFor.current === game.id) return;
    handSubmittedFor.current = game.id;
    void submitHand(myDeckIds());
  }, [game, isHost, submitHand]);

  const handleCopyCode = async () => {
    if (!game) return;
    await copy(game.code, "code");
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

  const yourName = game && (isHost ? game.hostName : game.guestName);
  const inMatch = game?.status === "playing" || game?.status === "finished";

  return (
    <div className="online-status-screen">
      <button className="link-button" onClick={onBack}>
        ← Cartas
      </button>

      <h1 className="setup-title">Jugar</h1>

      {game && inMatch ? (
        <CardsMatch game={game} isHost={isHost} onAnswer={submitAnswer} onRematch={rematch} />
      ) : game?.status === "ready" ? (
        <p className="online-waiting">Repartiendo cartas…</p>
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
                  {copiedKey === "code" ? "¡Copiado!" : "Copiar código"}
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
              aria-label="Código del rival"
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

      {!inMatch && yourName && <p className="online-waiting">Tú: {yourName}</p>}
    </div>
  );
}
