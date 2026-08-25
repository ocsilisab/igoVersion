import "./GameSetup.css";
import "./HomeScreen.css";

interface CardsMenuProps {
  onPlay: () => void;
  onChooseDeck: () => void;
  onBuy: () => void;
  onCancel: () => void;
}

/** Menu shell for the (not yet implemented) card game -- buttons don't do anything yet. */
export default function CardsMenu({ onPlay, onChooseDeck, onBuy, onCancel }: CardsMenuProps) {
  return (
    <div className="setup-screen">
      <div className="setup-content">
        <button className="link-button" onClick={onCancel}>
          ← Inicio
        </button>

        <h1 className="setup-title">Cartas</h1>
        <p className="setup-subtitle">Próximamente.</p>

        <div className="home-buttons">
          <button className="home-btn home-btn-primary" onClick={onPlay}>
            Jugar
          </button>
          <button className="home-btn" onClick={onChooseDeck}>
            Elegir baraja
          </button>
          <button className="home-btn" onClick={onBuy}>
            Comprar
          </button>
        </div>
      </div>
    </div>
  );
}
