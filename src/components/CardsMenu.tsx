import { useState } from "react";
import CardsTutorialModal from "./CardsTutorialModal";
import "./GameSetup.css";
import "./HomeScreen.css";

interface CardsMenuProps {
  onPlay: () => void;
  onChooseDeck: () => void;
  onBuy: () => void;
  onCancel: () => void;
}

export default function CardsMenu({ onPlay, onChooseDeck, onBuy, onCancel }: CardsMenuProps) {
  const [showTutorial, setShowTutorial] = useState(false);

  return (
    <div className="setup-screen">
      <button className="tutorial-btn" onClick={() => setShowTutorial(true)}>
        Tutorial
      </button>

      {showTutorial && <CardsTutorialModal onClose={() => setShowTutorial(false)} />}

      <div className="setup-content">
        <button className="link-button" onClick={onCancel}>
          ← Inicio
        </button>

        <h1 className="setup-title">Cartas</h1>
        <p className="setup-subtitle">Resuelve problemas de Go contra otro jugador antes que él. "Comprar" todavía no está disponible.</p>

        <div className="home-buttons">
          <button className="home-btn home-btn-primary" onClick={onPlay}>
            Jugar
          </button>
          <button className="home-btn" onClick={onChooseDeck}>
            Elegir baraja
          </button>
          <button className="home-btn home-btn-disabled" onClick={onBuy} disabled title="Todavía no disponible">
            Comprar (próximamente)
          </button>
        </div>
      </div>
    </div>
  );
}
