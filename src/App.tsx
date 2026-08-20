import { useEffect, useState } from "react";
import HomeScreen from "./components/HomeScreen";
import SoloSetup from "./components/SoloSetup";
import GameScreen from "./components/GameScreen";
import GameSetup from "./components/GameSetup";
import AiGameScreen from "./components/AiGameScreen";
import OnlineSetup from "./components/OnlineSetup";
import CreateOnlineGame from "./components/CreateOnlineGame";
import JoinOnlineGame from "./components/JoinOnlineGame";
import OnlineGameScreen from "./components/OnlineGameScreen";
import type { AiDifficulty, BoardSize, ExtensionRules, Player, TeamRoster } from "./types/game";
import "./App.css";

type Screen =
  | "home"
  | "solo-setup"
  | "solo-game"
  | "ai-setup"
  | "ai-game"
  | "online-setup"
  | "online-create"
  | "online-join"
  | "online-game";

interface SoloConfig {
  boardSize: BoardSize;
  komi: number;
  teams: TeamRoster;
  extensions: ExtensionRules;
}

interface AiConfig {
  boardSize: BoardSize;
  playerColor: Player;
  komi: number;
  humanNames: string[];
  extensions: ExtensionRules;
  difficulty: AiDifficulty;
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
      />
    );
  }

  if (screen === "solo-setup") {
    return (
      <SoloSetup
        onCancel={() => setScreen("home")}
        onStart={(boardSize, komi, teams, extensions) => {
          setSoloConfig({ boardSize, komi, teams, extensions });
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
        onExit={() => setScreen("home")}
      />
    );
  }

  if (screen === "ai-setup") {
    return (
      <GameSetup
        onCancel={() => setScreen("home")}
        onStart={(boardSize, playerColor, komi, humanNames, extensions, difficulty) => {
          setAiConfig({ boardSize, playerColor, komi, humanNames, extensions, difficulty });
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
        onExit={() => setScreen("home")}
      />
    );
  }

  if (screen === "online-setup") {
    return <OnlineSetup onCancel={goHome} onCreate={() => setScreen("online-create")} onJoin={() => setScreen("online-join")} />;
  }

  if (screen === "online-create") {
    return <CreateOnlineGame onCancel={() => setScreen("online-setup")} onCreated={enterOnlineGame} />;
  }

  if (screen === "online-join") {
    return <JoinOnlineGame onCancel={() => setScreen("online-setup")} onJoined={enterOnlineGame} />;
  }

  if (screen === "online-game" && onlineGameId) {
    return <OnlineGameScreen gameId={onlineGameId} inviteToken={inviteToken} onExit={goHome} />;
  }

  return null;
}
