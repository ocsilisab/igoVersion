import { useEffect, useState } from "react";
import HomeScreen from "./components/HomeScreen";
import SoloSetup from "./components/SoloSetup";
import GameScreen from "./components/GameScreen";
import GameSetup from "./components/GameSetup";
import AiGameScreen from "./components/AiGameScreen";
import CreateOnlineGame from "./components/CreateOnlineGame";
import OnlineGameScreen from "./components/OnlineGameScreen";
import CardsMenu from "./components/CardsMenu";
import DeckBuilder from "./components/DeckBuilder";
import CardsPlay from "./components/CardsPlay";
import { hasSavedDeck } from "./cards/collection";
import type { AiDifficulty, BoardSize, ExtensionRules, Player, TeamRoster } from "./types/game";
import type { TimeControl } from "./utils/clock";
import "./App.css";

type Screen =
  | "home"
  | "solo-setup"
  | "solo-game"
  | "ai-setup"
  | "ai-game"
  | "online-setup"
  | "online-game"
  | "cards-menu"
  | "deck-builder"
  | "cards-play";

interface SoloConfig {
  boardSize: BoardSize;
  komi: number;
  teams: TeamRoster;
  extensions: ExtensionRules;
  timeControl: TimeControl | null;
}

interface AiConfig {
  boardSize: BoardSize;
  playerColor: Player;
  komi: number;
  humanNames: string[];
  extensions: ExtensionRules;
  difficulty: AiDifficulty;
  timeControl: TimeControl | null;
}

/**
 * The app otherwise has no URL routing (screens are plain in-memory state), but an
 * online game's id has to survive a full page reload — see useOnlineGame's reconnect
 * requirement — so just that one piece of state is mirrored into `?game=<id>` via the
 * History API rather than pulling in a routing library for a single deep link.
 */
function readGameIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("game");
}

/** A personal invite link (`?game=<id>&token=<token>`) — see CreateOnlineGame/OnlineGameScreen. */
function readInviteTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => (readGameIdFromUrl() ? "online-game" : "home"));
  const [soloConfig, setSoloConfig] = useState<SoloConfig | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [onlineGameId, setOnlineGameId] = useState<string | null>(() => readGameIdFromUrl());
  const [inviteToken] = useState<string | null>(() => readInviteTokenFromUrl());
  const [deckRequiredNotice, setDeckRequiredNotice] = useState(false);

  useEffect(() => {
    const onPopState = () => {
      const id = readGameIdFromUrl();
      if (id) {
        setOnlineGameId(id);
        setScreen("online-game");
      } else {
        setScreen("home");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const goHome = () => {
    window.history.pushState(null, "", window.location.pathname);
    setOnlineGameId(null);
    setScreen("home");
  };

  const enterOnlineGame = (id: string) => {
    window.history.pushState(null, "", `?game=${id}`);
    setOnlineGameId(id);
    setScreen("online-game");
  };

  if (screen === "home") {
    return (
      <HomeScreen
        onPlaySolo={() => setScreen("solo-setup")}
        onPlayAi={() => setScreen("ai-setup")}
        onPlayOnline={() => setScreen("online-setup")}
        onPlayCards={() => setScreen("cards-menu")}
      />
    );
  }

  if (screen === "solo-setup") {
    return (
      <SoloSetup
        onCancel={() => setScreen("home")}
        onStart={(boardSize, komi, teams, extensions, timeControl) => {
          setSoloConfig({ boardSize, komi, teams, extensions, timeControl });
          setScreen("solo-game");
        }}
      />
    );
  }

  if (screen === "solo-game" && soloConfig) {
    return (
      <GameScreen
        boardSize={soloConfig.boardSize}
        komi={soloConfig.komi}
        teams={soloConfig.teams}
        extensions={soloConfig.extensions}
        timeControl={soloConfig.timeControl}
        onExit={() => setScreen("home")}
      />
    );
  }

  if (screen === "ai-setup") {
    return (
      <GameSetup
        onCancel={() => setScreen("home")}
        onStart={(boardSize, playerColor, komi, humanNames, extensions, difficulty, timeControl) => {
          setAiConfig({ boardSize, playerColor, komi, humanNames, extensions, difficulty, timeControl });
          setScreen("ai-game");
        }}
      />
    );
  }

  if (screen === "ai-game" && aiConfig) {
    return (
      <AiGameScreen
        boardSize={aiConfig.boardSize}
        playerColor={aiConfig.playerColor}
        komi={aiConfig.komi}
        humanNames={aiConfig.humanNames}
        extensions={aiConfig.extensions}
        difficulty={aiConfig.difficulty}
        timeControl={aiConfig.timeControl}
        onExit={() => setScreen("home")}
      />
    );
  }

  if (screen === "online-setup") {
    return <CreateOnlineGame onCancel={goHome} onEntered={enterOnlineGame} />;
  }

  if (screen === "online-game" && onlineGameId) {
    return (
      <OnlineGameScreen
        gameId={onlineGameId}
        inviteToken={inviteToken}
        onExit={goHome}
        onRematch={enterOnlineGame}
        onJoinAnother={enterOnlineGame}
      />
    );
  }

  if (screen === "cards-menu") {
    // Comprar not implemented yet.
    return (
      <CardsMenu
        onCancel={() => setScreen("home")}
        onPlay={() => {
          if (hasSavedDeck()) {
            setScreen("cards-play");
          } else {
            setDeckRequiredNotice(true);
            setScreen("deck-builder");
          }
        }}
        onChooseDeck={() => {
          setDeckRequiredNotice(false);
          setScreen("deck-builder");
        }}
        onBuy={() => {}}
      />
    );
  }

  if (screen === "deck-builder") {
    return (
      <DeckBuilder
        onBack={() => {
          setDeckRequiredNotice(false);
          setScreen("cards-menu");
        }}
        requiredNotice={deckRequiredNotice}
      />
    );
  }

  if (screen === "cards-play") {
    return <CardsPlay onBack={() => setScreen("cards-menu")} />;
  }

  // Reachable only if a screen's required config/id is missing (e.g. a reload that lands
  // on "solo-game" without soloConfig) -- rather than silently rendering a blank page,
  // send the player somewhere they can act from.
  return (
    <div className="app-fallback">
      <p>Algo ha ido mal y no se puede mostrar esta pantalla.</p>
      <button className="btn btn-primary" onClick={goHome}>
        Volver al inicio
      </button>
    </div>
  );
}
