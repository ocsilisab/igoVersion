import { useState } from "react";
import HomeScreen from "./components/HomeScreen";
import GameScreen from "./components/GameScreen";
import GameSetup from "./components/GameSetup";
import AiGameScreen from "./components/AiGameScreen";
import type { BoardSize, Player } from "./types/game";
import "./App.css";

type Screen = "home" | "solo-game" | "ai-setup" | "ai-game";

interface AiConfig {
  boardSize: BoardSize;
  playerColor: Player;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);

  if (screen === "home") {
    return (
      <HomeScreen onPlaySolo={() => setScreen("solo-game")} onPlayAi={() => setScreen("ai-setup")} />
    );
  }

  if (screen === "solo-game") {
    return <GameScreen onExit={() => setScreen("home")} />;
  }

  if (screen === "ai-setup") {
    return (
      <GameSetup
        onCancel={() => setScreen("home")}
        onStart={(boardSize, playerColor) => {
          setAiConfig({ boardSize, playerColor });
          setScreen("ai-game");
        }}
      />
    );
  }

  if (aiConfig) {
    return (
      <AiGameScreen
        boardSize={aiConfig.boardSize}
        playerColor={aiConfig.playerColor}
        onExit={() => setScreen("home")}
      />
    );
  }

  return null;
}
