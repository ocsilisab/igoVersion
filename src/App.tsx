import { useState } from "react";
import HomeScreen from "./components/HomeScreen";
import GameScreen from "./components/GameScreen";
import "./App.css";

type Screen = "home" | "game";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");

  if (screen === "home") {
    return <HomeScreen onPlaySolo={() => setScreen("game")} />;
  }

  return <GameScreen onExit={() => setScreen("home")} />;
}
