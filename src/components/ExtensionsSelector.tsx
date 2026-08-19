import type { ExtensionRules } from "../types/game";

interface ExtensionsSelectorProps {
  extensions: ExtensionRules;
  onChange: (extensions: ExtensionRules) => void;
  disabled?: boolean;
}

/** Optional house rules toggled at setup time — see utils/extensions.ts for what each does. */
export default function ExtensionsSelector({ extensions, onChange, disabled }: ExtensionsSelectorProps) {
  return (
    <section className="setup-section">
      <h2>Extensiones</h2>
      <div className="setup-options">
        <button
          type="button"
          className={`setup-option extension-option ${extensions.bombs ? "setup-option-active" : ""}`}
          onClick={() => onChange({ ...extensions, bombs: !extensions.bombs })}
          disabled={disabled}
        >
          <span className="extension-option-title">💣 Bombas</span>
          <span className="extension-option-desc">
            Cada 20 tiradas cae una bomba en una posición aleatoria y borra esa piedra y las de alrededor.
          </span>
        </button>
        <button
          type="button"
          className={`setup-option extension-option ${extensions.stars ? "setup-option-active" : ""}`}
          onClick={() => onChange({ ...extensions, stars: !extensions.stars })}
          disabled={disabled}
        >
          <span className="extension-option-title">⭐ Estrellas</span>
          <span className="extension-option-desc">Jugar junto a un hoshi también lo convierte en piedra tuya.</span>
        </button>
      </div>
    </section>
  );
}
