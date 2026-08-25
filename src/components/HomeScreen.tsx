import { useState } from "react";
import TutorialModal from "./TutorialModal";
import "./HomeScreen.css";

interface HomeScreenProps {
  onPlaySolo: () => void;
  onPlayAi: () => void;
  onPlayOnline: () => void;
}

export default function HomeScreen({ onPlaySolo, onPlayAi, onPlayOnline }: HomeScreenProps) {
  const [showTutorial, setShowTutorial] = useState(false);

  return (
    <div className="home-screen">
      <button className="tutorial-btn" onClick={() => setShowTutorial(true)}>
        Tutorial
      </button>

      {showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} />}

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

          <button className="home-btn" onClick={onPlayAi}>
            Jugar con IA
          </button>

          <button className="home-btn" onClick={onPlayOnline}>
            Jugar online
          </button>
        </div>
      </div>
    </div>
  );
}
