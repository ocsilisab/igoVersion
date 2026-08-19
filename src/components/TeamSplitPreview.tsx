import type { TeamRoster } from "../types/game";

interface TeamSplitPreviewProps {
  teams: TeamRoster;
}

/** Shows how players got grouped into the two teams — and calls out an uneven split. */
export default function TeamSplitPreview({ teams }: TeamSplitPreviewProps) {
  const uneven = teams.black.length !== teams.white.length;

  return (
    <div className="team-split-preview">
      <p>
        <span className="stone-dot stone-dot-black" /> Negras: {teams.black.join(", ")}
      </p>
      <p>
        <span className="stone-dot stone-dot-white" /> Blancas: {teams.white.join(", ")}
      </p>
      {uneven && (
        <p className="setup-hint">
          Número impar de jugadores: los equipos quedan descompensados ({teams.black.length} contra {teams.white.length}).
        </p>
      )}
    </div>
  );
}
