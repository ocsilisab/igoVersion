import "./GameSetup.css";
import "./HomeScreen.css";

interface OnlineSetupProps {
  onCreate: () => void;
  onJoin: () => void;
  onCancel: () => void;
}

export default function OnlineSetup({ onCreate, onJoin, onCancel }: OnlineSetupProps) {
  return (
    <div className="setup-screen">
      <div className="setup-content">
        <button className="link-button" onClick={onCancel}>
          ← Inicio
        </button>

        <h1 className="setup-title">Jugar online</h1>
        <p className="setup-subtitle">Juega una partida con otra persona desde dos dispositivos distintos.</p>

        <div className="home-buttons">
          <button className="home-btn home-btn-primary" onClick={onCreate}>
            Crear partida
          </button>
          <button className="home-btn" onClick={onJoin}>
            Unirse a partida
          </button>
        </div>
      </div>
    </div>
  );
}
