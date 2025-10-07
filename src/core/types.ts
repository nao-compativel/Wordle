export interface Player {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
}

export interface Cell {
  correctLetter: string;
  currentLetter: string;
  placedBy: string | null;
}

export interface Word {
  id: number;
  clue: string;
  direction: "across" | "down";
  startPosition: { row: number; col: number };
  length: number;
}

// Estado para jogos compartilhados (Normal, Zen, Turbo)
export interface GameState {
  board: (Cell | null)[][];
  words: Word[];
  players: Player[];
  theme: string;
  endTime: number;
  gameMode: "normal" | "zen" | "turbo";
  durationInSeconds: number;
}

// Estado individual de cada jogador no modo Versus
export interface VersusPlayerState {
  board: (Cell | null)[][];
  words: Word[];
}

// Estado completo de um jogo Versus
export interface VersusGameState {
  players: Player[];
  playerStates: Map<string, VersusPlayerState>;
  endTime: number;
  gameMode: "versus";
  theme: string;
  durationInSeconds: number;
}
