import { useMemo } from "react";
import { useCardCollection } from "../hooks/useCardCollection";
import { RANK_LEVELS } from "../cards/types";
import type { TesujiCard } from "../cards/types";
import RuleDiagram from "./RuleDiagram";
import "./DeckBuilder.css";

const TURN_LABEL = { black: "Negras", white: "Blancas" } as const;

interface DeckBuilderProps {
  onBack: () => void;
}

export default function DeckBuilder({ onBack }: DeckBuilderProps) {
  const { collection, deckIds, deckCount, maxDeckSize, toggleCard } = useCardCollection();

  const groups = useMemo(() => {
    const byRank = new Map<string, TesujiCard[]>();
    for (const card of collection) {
      const list = byRank.get(card.rank) ?? [];
      list.push(card);
      byRank.set(card.rank, list);
    }
    return RANK_LEVELS.map((rank) => ({ rank, cards: byRank.get(rank) ?? [] })).filter((g) => g.cards.length > 0);
  }, [collection]);

  const deckFull = deckCount >= maxDeckSize;

  return (
    <div className="deck-builder">
      <header className="deck-builder-header">
        <button className="link-button" onClick={onBack}>
          ← Cartas
        </button>
        <h1 className="deck-builder-title">Elegir baraja</h1>
        <p className="deck-builder-subtitle">
          Tienes {collection.length} cartas. Elige hasta {maxDeckSize} para tu baraja.
        </p>
      </header>

      <div className="deck-builder-status">
        <span className={`deck-count ${deckFull ? "deck-count-full" : ""}`}>
          {deckCount} / {maxDeckSize} seleccionadas
        </span>
        <span className="deck-saved-hint">Guardado automáticamente</span>
      </div>

      <div className="deck-builder-groups">
        {groups.map(({ rank, cards }) => (
          <section className="deck-rank-group" key={rank}>
            <h2 className="deck-rank-heading">{rank}</h2>
            <div className="deck-card-grid">
              {cards.map((card) => {
                const selected = deckIds.has(card.id);
                const disabled = !selected && deckFull;
                return (
                  <button
                    key={card.id}
                    className={`tesuji-card ${selected ? "tesuji-card-selected" : ""}`}
                    onClick={() => toggleCard(card.id)}
                    disabled={disabled}
                    title={card.description}
                  >
                    <span className="tesuji-card-check">{selected ? "✓" : ""}</span>
                    <div className="tesuji-card-diagram">
                      <RuleDiagram size={card.problem.boardSize} stones={card.problem.stones} />
                    </div>
                    <span className="tesuji-card-name">{card.name}</span>
                    <span className="tesuji-card-desc">
                      Turno: {TURN_LABEL[card.problem.toPlay]}. {card.problem.prompt}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
