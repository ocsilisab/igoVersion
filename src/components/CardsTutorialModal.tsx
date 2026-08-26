import RuleDiagram from "./RuleDiagram";
import { useModalDismiss } from "../hooks/useModalDismiss";
import "./TutorialModal.css";

interface CardsTutorialModalProps {
  onClose: () => void;
}

export default function CardsTutorialModal({ onClose }: CardsTutorialModalProps) {
  const dialogRef = useModalDismiss<HTMLDivElement>(onClose);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="tutorial-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cards-tutorial-title"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tutorial-header">
          <h2 id="cards-tutorial-title">Cómo se juega a Cartas</h2>
          <button className="link-button tutorial-close" onClick={onClose} aria-label="Cerrar tutorial">
            ✕
          </button>
        </div>

        <div className="tutorial-body">
          <section className="tutorial-section">
            <RuleDiagram
              size={5}
              stones={[
                { row: 0, col: 0, color: "black" },
                { row: 0, col: 1, color: "white" },
              ]}
            />
            <div className="tutorial-text">
              <h3>Las cartas son problemas de verdad</h3>
              <p>
                El juego tiene 150 cartas, y cada una es un problema real de Go (un "tesuji"): un tablero pequeño
                con una posición concreta y un único punto que la resuelve — capturar un grupo rival o salvar el
                tuyo de la atari. Van de nivel 15 kyu (muy fácil) hasta 9 dan (muy difícil).
              </p>
            </div>
          </section>

          <section className="tutorial-section tutorial-section-text-only">
            <div className="tutorial-text">
              <h3>Tu colección y tu baraja</h3>
              <p>
                De esas 150 cartas, te tocan 80 al azar la primera vez que entras — son tuyas para siempre. En
                "Elegir baraja" puedes marcar hasta 50 de esas 80 para formar la baraja con la que vas a jugar. Se
                guarda automáticamente.
              </p>
            </div>
          </section>

          <section className="tutorial-section tutorial-section-text-only">
            <div className="tutorial-text">
              <h3>Conectar con otro jugador</h3>
              <p>
                Al pulsar "Jugar" te sale un código para compartir con la otra persona, y un hueco para meter el
                código que ella te pase a ti. En cuanto uno de los dos introduce el código del otro, la partida
                empieza para ambos — no hace falta que los dos lo hagáis.
              </p>
            </div>
          </section>

          <section className="tutorial-section tutorial-section-text-only">
            <div className="tutorial-text">
              <h3>La partida: quien resuelve antes, gana</h3>
              <p>
                Cada jugador recibe 5 cartas al azar de su propia baraja (pueden repetirse). Tienes que resolver
                las 5 haciendo clic en el punto correcto del tablero. Cada fallo suma 5 segundos a tu contador, así
                que hay que acertar rápido y bien. El primero de los dos en resolver sus 5 cartas gana la partida.
              </p>
            </div>
          </section>
        </div>

        <div className="tutorial-footer">
          <button className="btn btn-primary" onClick={onClose}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
