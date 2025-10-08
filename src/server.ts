import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  GameState,
  Player,
  Cell,
  Word,
  VersusGameState,
  VersusPlayerState,
} from "./core/types.js";
import { generateBoard } from "./core/generateBoard.js";

// --- SETUP ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dictionariesPath = path.join(__dirname, "..", "dictionaries");
const availableThemes = fs
  .readdirSync(dictionariesPath)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(".json", ""));
if (availableThemes.length === 0) {
  console.error("ERRO: Nenhum dicionário encontrado.");
  process.exit(1);
}
console.log(`Temas disponíveis: ${availableThemes.join(", ")}`);

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const games = new Map<string, GameState | VersusGameState>();
const playerToGameMap = new Map<string, string>();
const gameTimers = new Map<string, NodeJS.Timeout>();

// --- CONSTANTES DE JOGO ---
const GAME_DURATIONS_SECONDS = {
  turbo: 5 * 60, // 5 minutos
  versus: 1 * 60 + 30, // 1 minuto e 30 segundos
};

// --- GUARDAS DE TIPO E AUXILIARES ---
function isVersusGame(
  game: GameState | VersusGameState
): game is VersusGameState {
  return game.gameMode === "versus";
}

function pickThemes(numThemes: number): string[] {
  const numToSelect = Math.max(
    1,
    Math.min(numThemes || 1, availableThemes.length)
  );
  let themesToUse: string[] = [];
  if (availableThemes.includes("gerais") && numToSelect > 1) {
    const otherThemes = availableThemes.filter((t) => t !== "gerais");
    themesToUse.push("gerais");
    const shuffledOthers = otherThemes.sort(() => 0.5 - Math.random());
    themesToUse.push(...shuffledOthers.slice(0, numToSelect - 1));
  } else {
    const shuffledThemes = [...availableThemes].sort(() => 0.5 - Math.random());
    themesToUse = shuffledThemes.slice(0, numToSelect);
  }
  themesToUse.sort((a, b) => (a === "gerais" ? -1 : b === "gerais" ? 1 : 0));
  return themesToUse;
}

function getWordCells(board: (Cell | null)[][], word: Word): (Cell | null)[] {
  const cells: (Cell | null)[] = [];
  for (let i = 0; i < word.length; i++) {
    const r =
      word.direction === "down"
        ? word.startPosition.row + i
        : word.startPosition.row;
    const c =
      word.direction === "across"
        ? word.startPosition.col + i
        : word.startPosition.col;
    cells.push(board[r]?.[c] ?? null);
  }
  return cells;
}

function findCompletedWords(
  board: (Cell | null)[][],
  words: Word[],
  row: number,
  col: number
): Word[] {
  const affectedWords = words.filter((word) => {
    if (word.direction === "across")
      return (
        word.startPosition.row === row &&
        col >= word.startPosition.col &&
        col < word.startPosition.col + word.length
      );
    return (
      word.startPosition.col === col &&
      row >= word.startPosition.row &&
      row < word.startPosition.row + word.length
    );
  });

  return affectedWords.filter((word) => {
    const wordCells = getWordCells(board, word);
    if (!wordCells.every((c) => c && c.currentLetter !== "")) {
      return false;
    }
    const filledByUserCount = wordCells.filter(
      (c) => c && c.placedBy && c.placedBy !== "AUTO" && c.placedBy !== "SYSTEM"
    ).length;
    return filledByUserCount > 0;
  });
}

function isBoardComplete(board: (Cell | null)[][]): boolean {
  return !board.some((row) =>
    row.some((cell) => cell && cell.currentLetter === "")
  );
}

function broadcastGameState(gameId: string) {
  const game = games.get(gameId);
  if (!game) return;

  if (isVersusGame(game)) {
    game.players.forEach((player) => {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) {
        const gameStateForPlayer = {
          ...game,
          players: game.players.map((p) => ({
            id: p.id,
            name: p.name,
            score: p.score,
            isHost: p.isHost,
          })),
          myState: game.playerStates.get(player.id),
          playerStates: undefined,
        };
        playerSocket.emit("gameState", gameStateForPlayer);
      }
    });
  } else {
    io.to(gameId).emit("gameState", game);
  }
}

// --- LÓGICA DE CONEXÃO ---
io.on("connection", (socket: Socket) => {
  socket.on(
    "createGame",
    (data: {
      playerName: string;
      gameMode: "normal" | "zen" | "turbo" | "versus";
      numThemes: number;
    }) => {
      const gameId = `game_${Math.random().toString(36).substring(2, 6)}`;
      socket.join(gameId);
      playerToGameMap.set(socket.id, gameId);
      const newPlayer: Player = {
        id: socket.id,
        name: data.playerName,
        score: 0,
        isHost: true,
      };
      const themesToUse = pickThemes(data.numThemes || 1);

      if (data.gameMode === "versus") {
        const duration = GAME_DURATIONS_SECONDS.versus;
        const firstBoard = generateBoard(themesToUse);
        const newGame: VersusGameState = {
          gameMode: "versus",
          players: [newPlayer],
          playerStates: new Map<string, VersusPlayerState>(),
          endTime: Date.now() + duration * 1000,
          theme: themesToUse.join(" + "),
          durationInSeconds: duration,
        };
        newGame.playerStates.set(socket.id, {
          board: firstBoard.board,
          words: firstBoard.words,
        });
        games.set(gameId, newGame);

        const gameStateForClient = {
          ...newGame,
          players: newGame.players.map((p) => ({
            id: p.id,
            name: p.name,
            score: p.score,
            isHost: p.isHost,
          })),
          myState: newGame.playerStates.get(socket.id),
          playerStates: undefined,
        };
        socket.emit("gameCreated", { gameId, gameState: gameStateForClient });
      } else {
        const newGame = generateBoard(themesToUse) as GameState;
        newGame.gameMode = data.gameMode || "normal";
        const duration = GAME_DURATIONS_SECONDS.turbo;
        newGame.endTime =
          newGame.gameMode === "turbo"
            ? Date.now() + duration * 1000
            : Date.now();
        newGame.players = [newPlayer];
        newGame.durationInSeconds = newGame.gameMode === "turbo" ? duration : 0;
        games.set(gameId, newGame);
        socket.emit("gameCreated", { gameId, gameState: newGame });

        if (newGame.gameMode !== "zen") {
          const intervalTime = newGame.gameMode === "turbo" ? 15000 : 30000;
          const intervalId = setInterval(() => {
            const game = games.get(gameId);
            if (!game || isVersusGame(game)) {
              clearInterval(intervalId);
              return;
            }
            const emptyCells: { cell: Cell }[] = [];
            game.board.forEach((row) =>
              row.forEach((cell) => {
                if (cell && cell.currentLetter === "")
                  emptyCells.push({ cell });
              })
            );
            if (emptyCells.length > 0) {
              const randomCell =
                emptyCells[Math.floor(Math.random() * emptyCells.length)]!;
              randomCell.cell.currentLetter = randomCell.cell.correctLetter;
              randomCell.cell.placedBy = "AUTO";
              io.to(gameId).emit("playAutoRevealSound");
              if (isBoardComplete(game.board)) {
                const finalTime = Math.floor(
                  (Date.now() - game.endTime) / 1000
                );
                io.to(gameId).emit("gameOver", {
                  players: game.players,
                  finalTime,
                });
                games.delete(gameId);
              } else {
                broadcastGameState(gameId);
              }
            } else {
              clearInterval(intervalId);
              gameTimers.delete(gameId);
            }
          }, intervalTime);
          gameTimers.set(gameId, intervalId);
        }
      }
    }
  );

  socket.on("joinGame", (data: { gameId: string; playerName: string }) => {
    const game = games.get(data.gameId);
    if (!game) {
      socket.emit("gameError", { message: "Sala não encontrada!" });
      return;
    }
    socket.join(data.gameId);
    playerToGameMap.set(socket.id, data.gameId);
    const newPlayer: Player = {
      id: socket.id,
      name: data.playerName,
      score: 0,
      isHost: false,
    };
    if (!game.players.some((p) => p.id === socket.id))
      game.players.push(newPlayer);

    if (isVersusGame(game)) {
      const themesToUse = pickThemes(game.theme.split(" + ").length);
      const newBoard = generateBoard(themesToUse);
      game.playerStates.set(socket.id, {
        board: newBoard.board,
        words: newBoard.words,
      });
    }

    broadcastGameState(data.gameId);
  });

  socket.on(
    "placeLetter",
    (data: { gameId: string; row: number; col: number; letter: string }) => {
      const game = games.get(data.gameId);
      const player = game?.players.find((p) => p.id === socket.id);
      if (!game || !player) return;

      let letterIsCorrect = false;
      let boardToCheck: (Cell | null)[][] | undefined;

      if (isVersusGame(game)) {
        const playerState = game.playerStates.get(socket.id);
        if (!playerState) return;
        const cell = playerState.board[data.row]?.[data.col];
        if (
          cell &&
          cell.currentLetter === "" &&
          cell.correctLetter.toUpperCase() === data.letter.toUpperCase()
        ) {
          letterIsCorrect = true;
          cell.currentLetter = data.letter.toUpperCase();
          cell.placedBy = player.id;
          player.score += 1;

          const completedWords = findCompletedWords(
            playerState.board,
            playerState.words,
            data.row,
            data.col
          );
          if (completedWords.length > 0) {
            game.endTime += 10 * 1000 * completedWords.length;
            socket.emit("playCorrectSound");
            player.score += 5 * completedWords.length;
          }
          boardToCheck = playerState.board;
        }
      } else {
        const cell = game.board[data.row]?.[data.col];
        if (
          cell &&
          cell.currentLetter === "" &&
          cell.correctLetter.toUpperCase() === data.letter.toUpperCase()
        ) {
          letterIsCorrect = true;
          cell.currentLetter = data.letter.toUpperCase();
          cell.placedBy = player.id;

          const completedWords = findCompletedWords(
            game.board,
            game.words,
            data.row,
            data.col
          );

          if (completedWords.length > 0) {
            io.to(data.gameId).emit("playCorrectSound");
            if (game.gameMode === "turbo")
              game.endTime += 20 * 1000 * completedWords.length;

            completedWords.forEach((word) => {
              getWordCells(game.board, word).forEach((wordCell) => {
                if (wordCell?.placedBy) {
                  const scoringPlayer = game.players.find(
                    (p) => p.id === wordCell.placedBy
                  );
                  if (scoringPlayer) scoringPlayer.score += 1;
                }
              });
            });
          }
          boardToCheck = game.board;
        }
      }

      if (letterIsCorrect) {
        if (boardToCheck && isBoardComplete(boardToCheck)) {
          const finalTime = Math.floor((Date.now() - game.endTime) / 1000);
          io.to(data.gameId).emit("gameOver", {
            players: game.players,
            finalTime: isVersusGame(game) ? game.durationInSeconds : finalTime,
          });
          games.delete(data.gameId);
        } else {
          broadcastGameState(data.gameId);
        }
      } else {
        socket.emit("playWrongSound");
      }
    }
  );

  socket.on("rematch", (data: { oldGameId: string }) => {
    // (seu código de rematch permanece aqui)
  });

  socket.on("disconnect", () => {
    const gameId = playerToGameMap.get(socket.id);
    if (!gameId) return;
    const game = games.get(gameId);
    if (!game) {
      playerToGameMap.delete(socket.id);
      return;
    }

    game.players = game.players.filter((p) => p.id !== socket.id);

    if (isVersusGame(game)) game.playerStates.delete(socket.id);

    if (game.players.length === 0) {
      const t = gameTimers.get(gameId);
      if (t) clearInterval(t);
      gameTimers.delete(gameId);
      games.delete(gameId);
    } else {
      if (!game.players.some((p) => p.isHost)) {
        const newHost = game.players[0];
        if (newHost) newHost.isHost = true;
      }
      broadcastGameState(gameId);
    }
    playerToGameMap.delete(socket.id);
  });
});

// --- LOOP PRINCIPAL DO SERVIDOR PARA VERIFICAR FIM DE JOGO POR TEMPO ---
setInterval(() => {
  const now = Date.now();
  for (const [gameId, game] of games.entries()) {
    if (game.gameMode === "turbo" || game.gameMode === "versus") {
      if (now > game.endTime) {
        console.log(`Tempo esgotado para o jogo ${gameId}. Encerrando.`);

        io.to(gameId).emit("gameOver", {
          players: game.players,
          finalTime: game.durationInSeconds,
        });

        const timer = gameTimers.get(gameId);
        if (timer) clearInterval(timer);
        gameTimers.delete(gameId);

        game.players.forEach((p) => playerToGameMap.delete(p.id));
        games.delete(gameId);
      }
    }
  }
}, 1000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
