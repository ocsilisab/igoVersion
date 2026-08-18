import "./HomeScreen.css";

interface HomeScreenProps {
  onPlaySolo: () => void;
}

export default function HomeScreen({ onPlaySolo }: HomeScreenProps) {
  return (
    <div className="home-screen">
      <div className="home-content">
        <h1 className="home-title">碁 Go</h1>
        <p className="home-subtitle">
          El clásico juego de estrategia japonés. Juega una partida local, dos personas en el
          mismo dispositivo.
        </p>

        <div className="home-buttons">
          <button className="home-btn home-btn-primary" onClick={onPlaySolo}>
            Jugar solo
          </button>

          <button className="home-btn home-btn-disabled" disabled>
            Jugar con IA
            <span className="badge">Próximamente</span>
          </button>

          <button className="home-btn home-btn-disabled" disabled>
            Jugar online
            <span className="badge">Próximamente</span>
          </button>
        </div>
      </div>
    </div>
  );
}
