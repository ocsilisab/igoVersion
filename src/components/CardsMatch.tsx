import { useEffect, useState } from "react";
import type { CardGame } from "../online/cardGameTypes";
import { ALL_TESUJI_CARDS } from "../cards/tesujiCards";
import RuleDiagram from "./RuleDiagram";
import "./CardsMatch.css";

interface CardsMatchProps {
  game: CardGame;
  isHost: boolean;
  onAnswer: (row: number, col: number) => Promise<boolean>;
  onRematch: () => Promise<void>;
}

const CARDS_BY_ID = new Map(ALL_TESUJI_CARDS.map((c) => [c.id, c]));
const HAND_SIZE = 5;

export default function CardsMatch({ game, isHost, onAnswer, onRematch }: CardsMatchProps) {
  const myHand = isHost ? game.hostHand : game.guestHand;
  const myProgress = isHost ? game.hostProgress : game.guestProgress;
  const myMistakes = isHost ? game.hostMistakes : game.guestMistakes;
  const opponentProgress = isHost ? game.guestProgress : game.hostProgress;
  const opponentMistakes = isHost ? game.guestMistakes : game.hostMistakes;
  const opponentName = isHost ? game.guestName : game.hostName;
  const won = game.winner === (isHost ? "host" : "guest");

  const [wrongPoints, setWrongPoints] = useState<{ row: number; col: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [requestingRematch, setRequestingRematch] = useState(false);

  // A fresh card (new progress) starts with no wrong-guess marks of its own.
  useEffect(() => {
    setWrongPoints([]);
  }, [myProgress]);

  useEffect(() => {
    if (game.status !== "playing") return;
    const interval = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(interval);
  }, [game.status]);

  if (game.status === "finished") {
    const handleRematch = async () => {
      setRequestingRematch(true);
      await onRematch();
      setRequestingRematch(false);
    };

    return (
      <div className="cards-match-result">
        <h2>{won ? "¡Has ganado!" : `Ha ganado ${opponentName ?? "el rival"}`}</h2>
        <p>
          Tú: {myProgress}/{HAND_SIZE} resueltas, {myMistakes} fallo{myMistakes === 1 ? "" : "s"}.
        </p>
        <p>
          Rival: {opponentProgress}/{HAND_SIZE} resueltas, {opponentMistakes} fallo{opponentMistakes === 1 ? "" : "s"}.
        </p>
        <button className="btn btn-primary" onClick={() => void handleRematch()} disabled={requestingRematch}>
          {requestingRematch ? "Preparando revancha…" : "Revancha"}
        </button>
      </div>
    );
  }

  const currentCard = myHand && myProgress < myHand.length ? CARDS_BY_ID.get(myHand[myProgress]) : null;
  if (!currentCard) {
    return <p className="online-waiting">Preparando cartas…</p>;
  }

  const elapsedMs = game.startedAt ? Math.max(0, now - new Date(game.startedAt).getTime()) : 0;
  const effectiveSeconds = ((elapsedMs + myMistakes * 5000) / 1000).toFixed(1);

  const handlePoint = async (row: number, col: number) => {
    if (submitting) return;
    setSubmitting(true);
    const correct = await onAnswer(row, col);
    if (!correct) setWrongPoints((prev) => [...prev, { row, col }]);
    setSubmitting(false);
  };

  return (
    <div className="cards-match">
      <div className="cards-match-status">
        <span>
          Tú: {myProgress}/{HAND_SIZE}
        </span>
        <span className="cards-match-timer">{effectiveSeconds}s</span>
        <span>
          Rival: {opponentProgress}/{HAND_SIZE}
        </span>
      </div>

      <p className="cards-match-prompt">{currentCard.problem.prompt}</p>

      <RuleDiagram
        size={currentCard.problem.boardSize}
        stones={currentCard.problem.stones}
        wrongPoints={wrongPoints}
        onPointClick={submitting ? undefined : (row, col) => void handlePoint(row, col)}
      />

      {myMistakes > 0 && (
        <p className="cards-match-mistakes">
          +{myMistakes * 5}s por {myMistakes} fallo{myMistakes === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
