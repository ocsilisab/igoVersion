import RuleDiagram from "./RuleDiagram";
import { useModalDismiss } from "../hooks/useModalDismiss";
import "./TutorialModal.css";

interface TutorialModalProps {
  onClose: () => void;
}

export default function TutorialModal({ onClose }: TutorialModalProps) {
  const dialogRef = useModalDismiss<HTMLDivElement>(onClose);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="tutorial-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tutorial-header">
          <h2 id="tutorial-title">Cómo se juega al Go</h2>
          <button className="link-button tutorial-close" onClick={onClose} aria-label="Cerrar tutorial">
            ✕
          </button>
        </div>

        <div className="tutorial-body">
          <section className="tutorial-section">
            <RuleDiagram
              size={5}
              stones={[
                { row: 1, col: 1, color: "black" },
                { row: 1, col: 3, color: "white" },
                { row: 2, col: 3, color: "black" },
                { row: 3, col: 1, color: "white" },
              ]}
            />
            <div className="tutorial-text">
              <h3>El tablero y las piedras</h3>
              <p>
                Negras y Blancas colocan piedras alternándose, siempre sobre las intersecciones vacías de la
                cuadrícula (no en las casillas) — nunca dentro de una casilla. Negras siempre empieza. Una vez
                colocada, una piedra no se mueve nunca: solo puede quedarse donde está o ser capturada y retirada
                del tablero.
              </p>
            </div>
          </section>

          <section className="tutorial-section">
            <RuleDiagram
              size={5}
              stones={[{ row: 2, col: 2, color: "black" }]}
              liberties={[
                { row: 1, col: 2 },
                { row: 3, col: 2 },
                { row: 2, col: 1 },
                { row: 2, col: 3 },
              ]}
            />
            <div className="tutorial-text">
              <h3>Libertades</h3>
              <p>
                Cada piedra (o grupo de piedras conectadas) tiene "libertades": los puntos vacíos justo al lado.
                Una piedra en el centro del tablero tiene hasta 4 libertades (marcadas aquí en verde); una en el
                borde tiene 3, y una en la esquina solo 2. Un grupo con más piedras conectadas comparte todas sus
                libertades entre sí.
              </p>
            </div>
          </section>

          <section className="tutorial-section">
            <div className="tutorial-diagram-pairs">
              <div>
                <p className="tutorial-diagram-pairs-label">Una sola piedra</p>
                <div className="tutorial-diagram-pair">
                  <RuleDiagram
                    size={5}
                    caption="Antes"
                    stones={[
                      { row: 2, col: 2, color: "black" },
                      { row: 1, col: 2, color: "white" },
                      { row: 3, col: 2, color: "white" },
                      { row: 2, col: 1, color: "white" },
                    ]}
                    liberties={[{ row: 2, col: 3 }]}
                  />
                  <RuleDiagram
                    size={5}
                    caption="Después"
                    stones={[
                      { row: 2, col: 2, color: "black", dead: true },
                      { row: 1, col: 2, color: "white" },
                      { row: 3, col: 2, color: "white" },
                      { row: 2, col: 1, color: "white" },
                      { row: 2, col: 3, color: "white" },
                    ]}
                  />
                </div>
              </div>

              <div>
                <p className="tutorial-diagram-pairs-label">Un grupo de varias piedras</p>
                <div className="tutorial-diagram-pair">
                  <RuleDiagram
                    size={5}
                    caption="Antes"
                    stones={[
                      { row: 0, col: 1, color: "black" },
                      { row: 0, col: 2, color: "black" },
                      { row: 0, col: 0, color: "white" },
                      { row: 1, col: 1, color: "white" },
                      { row: 1, col: 2, color: "white" },
                    ]}
                    liberties={[{ row: 0, col: 3 }]}
                  />
                  <RuleDiagram
                    size={5}
                    caption="Después"
                    stones={[
                      { row: 0, col: 1, color: "black", dead: true },
                      { row: 0, col: 2, color: "black", dead: true },
                      { row: 0, col: 0, color: "white" },
                      { row: 1, col: 1, color: "white" },
                      { row: 1, col: 2, color: "white" },
                      { row: 0, col: 3, color: "white" },
                    ]}
                  />
                </div>
              </div>
            </div>
            <div className="tutorial-text">
              <h3>Capturas</h3>
              <p>
                Cuando a un grupo le rodean por completo y se queda sin ninguna libertad, se captura entero de
                golpe y se retira del tablero — da igual si es una sola piedra o un grupo entero de piedras
                conectadas, como en los dos ejemplos: a la piedra (o grupo) negra solo le queda una libertad
                (marcada en verde); en cuanto Blancas juega ahí, todo el grupo negro se captura de golpe.
              </p>
            </div>
          </section>

          <section className="tutorial-section">
            <RuleDiagram
              size={5}
              stones={[
                { row: 0, col: 1, color: "black" },
                { row: 1, col: 0, color: "black" },
                { row: 4, col: 3, color: "white" },
                { row: 3, col: 4, color: "white" },
              ]}
              territory={[
                { row: 0, col: 0, color: "black" },
                { row: 4, col: 4, color: "white" },
              ]}
            />
            <div className="tutorial-text">
              <h3>Territorio y fin de partida</h3>
              <p>
                La partida termina cuando los dos jugadores pasan seguidos. Entonces se marcan como muertas las
                piedras que ya no puedan sobrevivir (la app las tacha con una X) y se cuenta el territorio: los
                puntos vacíos rodeados solo por un color, marcados con un cuadrito de ese color. La puntuación
                final suma piedras vivas en el tablero + territorio + capturas. Gana quien sume más.
              </p>
            </div>
          </section>

          <section className="tutorial-section tutorial-section-text-only">
            <div className="tutorial-text">
              <h3>Komi</h3>
              <p>
                Como Negras juega primero, tiene cierta ventaja. Para compensarla, Blancas recibe unos puntos
                extra al final de la partida llamados "komi" — normalmente 6.5 o 7.5. El .5 evita que la partida
                pueda acabar en empate.
              </p>
            </div>
          </section>

          <section className="tutorial-section tutorial-section-text-only">
            <div className="tutorial-text">
              <h3>La regla del Ko</h3>
              <p>
                Tras una captura de una sola piedra, a veces el rival podría recapturar inmediatamente en el
                mismo punto, devolviendo el tablero exactamente a como estaba justo antes de su propia jugada —
                repitiendo la posición una y otra vez sin fin. La regla del Ko lo prohíbe: no puedes jugar una
                piedra si el resultado repite exactamente una posición anterior del tablero. Hay que jugar en
                otro sitio primero.
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
