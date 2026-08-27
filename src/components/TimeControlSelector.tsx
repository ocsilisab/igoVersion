import { useState } from "react";
import type { TimeControl, TimeControlStyle } from "../utils/clock";

interface Preset {
  label: string;
  value: TimeControl;
}

const JAPANESE_PRESETS: Preset[] = [
  { label: "Rápida", value: { style: "japanese", mainSeconds: 5 * 60, periods: 3, periodSeconds: 10 } },
  { label: "Normal", value: { style: "japanese", mainSeconds: 15 * 60, periods: 3, periodSeconds: 30 } },
  { label: "Larga", value: { style: "japanese", mainSeconds: 30 * 60, periods: 5, periodSeconds: 30 } },
];

const CANADIAN_PRESETS: Preset[] = [
  { label: "Normal", value: { style: "canadian", mainSeconds: 15 * 60, moves: 20, seconds: 5 * 60 } },
  { label: "Larga", value: { style: "canadian", mainSeconds: 30 * 60, moves: 25, seconds: 10 * 60 } },
];

const DEFAULT_CUSTOM_JAPANESE: TimeControl = { style: "japanese", mainSeconds: 15 * 60, periods: 3, periodSeconds: 30 };
const DEFAULT_CUSTOM_CANADIAN: TimeControl = { style: "canadian", mainSeconds: 15 * 60, moves: 20, seconds: 5 * 60 };

interface TimeControlSelectorProps {
  value: TimeControl | null;
  onChange: (value: TimeControl | null) => void;
  disabled?: boolean;
}

function sameTimeControl(a: TimeControl, b: TimeControl): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function presetsFor(style: TimeControlStyle): Preset[] {
  return style === "japanese" ? JAPANESE_PRESETS : CANADIAN_PRESETS;
}

/** Whole minutes, rounding to at least 1 so a custom value never silently becomes 0. */
function minutesInput(seconds: number, onMinutes: (minutes: number) => void, disabled?: boolean) {
  return (
    <input
      className="setup-input setup-input-narrow"
      type="number"
      min={1}
      value={Math.round(seconds / 60)}
      onChange={(e) => onMinutes(Math.max(1, Number(e.target.value) || 1))}
      disabled={disabled}
      aria-label="Minutos de tiempo principal"
    />
  );
}

export default function TimeControlSelector({ value, onChange, disabled }: TimeControlSelectorProps) {
  const [showCustom, setShowCustom] = useState(false);

  const style: TimeControlStyle = value?.style ?? "japanese";
  const isCustom = value !== null && !presetsFor(style).some((p) => sameTimeControl(p.value, value));

  const handleStyleChange = (nextStyle: TimeControlStyle) => {
    onChange(presetsFor(nextStyle)[0].value);
    setShowCustom(false);
  };

  const custom = isCustom ? value : style === "japanese" ? DEFAULT_CUSTOM_JAPANESE : DEFAULT_CUSTOM_CANADIAN;

  return (
    <section className="setup-section">
      <h2>Tiempo</h2>
      <div className="setup-options">
        <button
          type="button"
          className={`setup-option ${value === null ? "setup-option-active" : ""}`}
          onClick={() => {
            onChange(null);
            setShowCustom(false);
          }}
          disabled={disabled}
        >
          Sin límite
        </button>
        <button
          type="button"
          className={`setup-option ${value !== null ? "setup-option-active" : ""}`}
          onClick={() => value === null && handleStyleChange("japanese")}
          disabled={disabled}
        >
          Con reloj
        </button>
      </div>

      {value !== null && (
        <>
          <div className="setup-options">
            <button
              type="button"
              className={`setup-option ${style === "japanese" ? "setup-option-active" : ""}`}
              onClick={() => handleStyleChange("japanese")}
              disabled={disabled}
            >
              Byo-yomi japonés
            </button>
            <button
              type="button"
              className={`setup-option ${style === "canadian" ? "setup-option-active" : ""}`}
              onClick={() => handleStyleChange("canadian")}
              disabled={disabled}
            >
              Byo-yomi canadiense
            </button>
          </div>

          <div className="setup-options">
            {presetsFor(style).map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`setup-option ${!showCustom && sameTimeControl(preset.value, value) ? "setup-option-active" : ""}`}
                onClick={() => {
                  onChange(preset.value);
                  setShowCustom(false);
                }}
                disabled={disabled}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={`setup-option ${showCustom || isCustom ? "setup-option-active" : ""}`}
              onClick={() => {
                setShowCustom(true);
                if (!isCustom) onChange(custom);
              }}
              disabled={disabled}
            >
              Personalizado
            </button>
          </div>

          {(showCustom || isCustom) && (
            <div className="time-control-custom">
              <label>
                Tiempo principal (min)
                {minutesInput(custom.mainSeconds, (minutes) => onChange({ ...custom, mainSeconds: minutes * 60 }), disabled)}
              </label>
              {custom.style === "japanese" ? (
                <>
                  <label>
                    Periodos
                    <input
                      className="setup-input setup-input-narrow"
                      type="number"
                      min={1}
                      value={custom.periods}
                      onChange={(e) => onChange({ ...custom, periods: Math.max(1, Number(e.target.value) || 1) })}
                      disabled={disabled}
                      aria-label="Número de periodos de byo-yomi"
                    />
                  </label>
                  <label>
                    Segundos por periodo
                    <input
                      className="setup-input setup-input-narrow"
                      type="number"
                      min={5}
                      value={custom.periodSeconds}
                      onChange={(e) => onChange({ ...custom, periodSeconds: Math.max(5, Number(e.target.value) || 5) })}
                      disabled={disabled}
                      aria-label="Segundos por periodo de byo-yomi"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Jugadas por tramo
                    <input
                      className="setup-input setup-input-narrow"
                      type="number"
                      min={1}
                      value={custom.moves}
                      onChange={(e) => onChange({ ...custom, moves: Math.max(1, Number(e.target.value) || 1) })}
                      disabled={disabled}
                      aria-label="Jugadas por tramo canadiense"
                    />
                  </label>
                  <label>
                    Segundos por tramo
                    <input
                      className="setup-input setup-input-narrow"
                      type="number"
                      min={10}
                      value={custom.seconds}
                      onChange={(e) => onChange({ ...custom, seconds: Math.max(10, Number(e.target.value) || 10) })}
                      disabled={disabled}
                      aria-label="Segundos por tramo canadiense"
                    />
                  </label>
                </>
              )}
            </div>
          )}

          <p className="setup-hint">
            {style === "japanese"
              ? "Al agotar el tiempo principal, cada jugada tiene el tiempo de un periodo -- jugar a tiempo lo resetea; agotarlo consume un periodo. Perder todos los periodos es derrota por tiempo."
              : "Al agotar el tiempo principal, hay que completar el número de jugadas indicado dentro del tiempo del tramo -- conseguirlo renueva el tramo. No lograrlo es derrota por tiempo."}
          </p>
        </>
      )}
    </section>
  );
}
