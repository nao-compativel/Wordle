// Conecta ao servidor Socket.IO
const socket = io();

// ============================================================================
// --- ESTADO GLOBAL DO CLIENTE ---
// ============================================================================

let state = {
  gameId: null,
  playerId: null,
  currentGameState: null,
  activeWordId: null,
  activeDirection: "across",
  lastFocusedCell: { row: -1, col: -1 },
  cellToWordsMap: new Map(),
  gameTimerInterval: null,
};

// ============================================================================
// --- ELEMENTOS DO DOM ---
// ============================================================================

const dom = {
  welcomeScreen: document.getElementById("welcome-screen"),
  gameContainer: document.getElementById("game-container"),
  endGameScreen: document.getElementById("end-game-screen"),
  playerNameInput: document.getElementById("playerNameInput"),
  createGameBtn: document.getElementById("createGameBtn"),
  gameIdInput: document.getElementById("gameIdInput"),
  joinGameBtn: document.getElementById("joinGameBtn"),
  numThemesInput: document.getElementById("numThemesInput"),
  numThemesValue: document.getElementById("numThemesValue"),
  crosswordGrid: document.getElementById("crossword-grid"),
  cluesAcrossList: document.getElementById("clues-across-list"),
  cluesDownList: document.getElementById("clues-down-list"),
  gameIdDisplay: document.getElementById("game-id-display"),
  gameThemeDisplay: document.getElementById("game-theme-display"),
  playerList: document.getElementById("player-list"),
  timerDisplay: document.getElementById("timer-display"),
  versusPanel: document.getElementById("versus-panel"),
  opponentScoresList: document.getElementById("opponent-scores"),
  playersSection: document.getElementById("players-section"),
  errorMessage: document.getElementById("error-message"),
  finalTimeDisplay: document.getElementById("final-time"),
  finalScoresList: document.getElementById("final-scores"),
  rematchBtn: document.getElementById("rematch-btn"),
  lobbyBtn: document.getElementById("lobby-btn"),
  waitingForHostMsg: document.getElementById("waiting-for-host-msg"),
  sounds: {
    correct: document.getElementById("correct-sound"),
    wrong: document.getElementById("wrong-sound"),
    reveal: document.getElementById("reveal-sound"),
  },
};

// ============================================================================
// --- LÓGICA DE RENDERIZAÇÃO ---
// ============================================================================

/**
 * Função principal que redesenha toda a interface do jogo com base no estado recebido.
 * @param {object} gameState O objeto de estado completo do servidor.
 */
function render(gameState) {
  state.currentGameState = gameState;
  const isVersus = gameState.gameMode === "versus";

  // Extrai as informações corretas dependendo do modo de jogo
  const board =
    isVersus && gameState.myState ? gameState.myState.board : gameState.board;
  const words =
    isVersus && gameState.myState ? gameState.myState.words : gameState.words;

  // Validação para garantir que os dados existem antes de tentar renderizar
  if (!board || !words) {
    console.warn("Aguardando dados do tabuleiro para renderizar...");
    return;
  }

  // Atualiza a interface
  dom.playersSection.classList.toggle("hidden", isVersus);
  dom.versusPanel.classList.toggle("hidden", !isVersus);

  buildCellToWordsMap(words);
  renderBoard(board, words);
  renderClues(words);
  renderInfo(gameState);
  renderTimer(gameState);
  updateHighlights();
}

/** Renderiza o tabuleiro de palavras cruzadas. */
function renderBoard(board, words) {
  // Guarda a célula que estava focada antes de redesenhar
  const focusedElement = document.activeElement;
  const focusedRow = focusedElement ? focusedElement.dataset.row : null;
  const focusedCol = focusedElement ? focusedElement.dataset.col : null;

  dom.crosswordGrid.innerHTML = "";
  if (!board?.[0]) return;

  dom.crosswordGrid.style.gridTemplateColumns = `repeat(${board[0].length}, 40px)`;
  dom.crosswordGrid.style.gridTemplateRows = `repeat(${board.length}, 40px)`;

  board.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const cellContainer = document.createElement("div");
      const key = `${rowIndex}-${colIndex}`;
      cellContainer.id = `cell-${key}`;

      if (!cell || cell.correctLetter === "_") {
        cellContainer.className = "cell-container block";
      } else {
        cellContainer.className = "cell-container";

        const startingWords = words.filter(
          (w) =>
            w.startPosition.row === rowIndex && w.startPosition.col === colIndex
        );
        if (startingWords.length > 0) {
          const clueNumber = document.createElement("span");
          clueNumber.className = "clue-number";
          clueNumber.textContent = startingWords.map((w) => w.id).join("/");
          cellContainer.appendChild(clueNumber);
        }

        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 1;
        input.className = "cell-input";
        input.dataset.row = rowIndex;
        input.dataset.col = colIndex;
        input.value = cell.currentLetter || "";

        if (cell.currentLetter) {
          input.disabled = true;
          if (cell.placedBy === "AUTO") {
            input.classList.add("auto-revealed");
          }
        }

        input.addEventListener("click", (e) =>
          handleCellClick(e, rowIndex, colIndex)
        );
        input.addEventListener("focus", () =>
          handleCellFocus(rowIndex, colIndex)
        );
        input.addEventListener("input", (e) =>
          handleInput(e, rowIndex, colIndex)
        );
        input.addEventListener("keydown", (e) =>
          handleKeyDown(e, rowIndex, colIndex)
        );

        cellContainer.appendChild(input);
      }
      dom.crosswordGrid.appendChild(cellContainer);
    });
  });

  // Restaura o foco na célula que estava selecionada
  if (focusedRow && focusedCol) {
    focusCell(parseInt(focusedRow, 10), parseInt(focusedCol, 10));
  }
}

/** Renderiza as listas de dicas (horizontais e verticais). */
function renderClues(words) {
  dom.cluesAcrossList.innerHTML = "";
  dom.cluesDownList.innerHTML = "";
  words
    .sort((a, b) => a.id - b.id)
    .forEach((word) => {
      const li = document.createElement("li");
      li.textContent = `${word.id}. ${word.clue}`;
      li.addEventListener("click", () => {
        state.activeWordId = word.id;
        state.activeDirection = word.direction;
        updateHighlights();
        focusCell(word.startPosition.row, word.startPosition.col);
      });

      if (word.direction === "across") {
        dom.cluesAcrossList.appendChild(li);
      } else {
        dom.cluesDownList.appendChild(li);
      }
    });
}

/** Renderiza o painel de informações (ID da sala, tema, jogadores). */
function renderInfo(gameState) {
  dom.gameIdDisplay.textContent = state.gameId;
  dom.gameThemeDisplay.textContent = (gameState.theme || "")
    .replaceAll("_", " ")
    .toUpperCase();

  const playerListContainer =
    gameState.gameMode === "versus" ? dom.opponentScoresList : dom.playerList;
  playerListContainer.innerHTML = "";

  // O gameState.players pode não existir no modo versus, então verificamos.
  const players = gameState.players || [];
  players
    .sort((a, b) => b.score - a.score)
    .forEach((player) => {
      const li = document.createElement("li");
      li.textContent = `${player.name} ${player.isHost ? "👑" : ""}: ${
        player.score
      } pontos`;
      if (player.id === state.playerId) {
        li.style.fontWeight = "bold";
      }
      playerListContainer.appendChild(li);
    });
}

/** Inicia ou atualiza o cronômetro. */
function renderTimer({ gameMode, endTime }) {
  if (state.gameTimerInterval) clearInterval(state.gameTimerInterval);
  if (!dom.timerDisplay) return;

  state.gameTimerInterval = setInterval(() => {
    let minutes, seconds;
    const isRegressive = gameMode === "turbo" || gameMode === "versus";

    if (isRegressive) {
      const remaining = Math.max(0, endTime - Date.now());
      const totalSeconds = Math.floor(remaining / 1000);
      minutes = Math.floor(totalSeconds / 60)
        .toString()
        .padStart(2, "0");
      seconds = (totalSeconds % 60).toString().padStart(2, "0");
    } else {
      const elapsed = Math.floor((Date.now() - endTime) / 1000);
      minutes = Math.floor(elapsed / 60)
        .toString()
        .padStart(2, "0");
      seconds = (elapsed % 60).toString().padStart(2, "0");
    }
    dom.timerDisplay.textContent = `${minutes}:${seconds}`;
  }, 1000);
}

// ============================================================================
// --- MANIPULADORES DE EVENTOS DO USUÁRIO ---
// ============================================================================

function handleInput(event, row, col) {
  const letter = event.target.value.toUpperCase();
  if (letter && /^[A-ZÇ]$/.test(letter)) {
    socket.emit("placeLetter", { gameId: state.gameId, row, col, letter });

    const board =
      state.currentGameState.gameMode === "versus"
        ? state.currentGameState.myState.board
        : state.currentGameState.board;
    let words =
      state.currentGameState.gameMode === "versus"
        ? state.currentGameState.myState.words
        : state.currentGameState.words;

    let activeWord = words.find(
      (w) =>
        w.id === state.activeWordId && w.direction === state.activeDirection
    );

    if (!activeWord) {
      const wordsInCell = state.cellToWordsMap.get(`${row}-${col}`) || [];
      activeWord =
        wordsInCell.find((w) => w.direction === state.activeDirection) ||
        wordsInCell[0];
    }

    if (activeWord) {
      for (let i = 0; i < activeWord.length; i++) {
        const r =
          activeWord.direction === "down"
            ? activeWord.startPosition.row + i
            : activeWord.startPosition.row;
        const c =
          activeWord.direction === "across"
            ? activeWord.startPosition.col + i
            : activeWord.startPosition.col;
        if (r > row || (r === row && c > col)) {
          if (board[r]?.[c]?.currentLetter === "") {
            focusCell(r, c);
            return;
          }
        }
      }
    }
  }
  event.target.value = "";
}

function handleKeyDown(event, row, col) {
  let nextRow = row,
    nextCol = col;
  const key = event.key;

  if (key.includes("Arrow")) {
    event.preventDefault();
    if (key === "ArrowUp") {
      if (state.activeDirection !== "down") {
        state.activeDirection = "down";
        updateHighlights();
      }
      nextRow--;
    }
    if (key === "ArrowDown") {
      if (state.activeDirection !== "down") {
        state.activeDirection = "down";
        updateHighlights();
      }
      nextRow++;
    }
    if (key === "ArrowLeft") {
      if (state.activeDirection !== "across") {
        state.activeDirection = "across";
        updateHighlights();
      }
      nextCol--;
    }
    if (key === "ArrowRight") {
      if (state.activeDirection !== "across") {
        state.activeDirection = "across";
        updateHighlights();
      }
      nextCol++;
    }
    focusCell(nextRow, nextCol);
  } else if (key === "Backspace" && event.target.value === "") {
    event.preventDefault();
    if (state.activeDirection === "down") nextRow--;
    else nextCol--;
    focusCell(nextRow, nextCol);
  } else if (key === " " || key === "Enter") {
    // Usar espaço ou Enter para alternar direção
    event.preventDefault();
    handleCellClick(event, row, col, true);
  }
}

function handleCellClick(event, row, col, forceToggle = false) {
  const isDoubleClick =
    state.lastFocusedCell.row === row && state.lastFocusedCell.col === col;
  const wordsInCell = state.cellToWordsMap.get(`${row}-${col}`) || [];

  if (wordsInCell.length > 1 && (isDoubleClick || forceToggle)) {
    state.activeDirection =
      state.activeDirection === "across" ? "down" : "across";
    const newWord = wordsInCell.find(
      (w) => w.direction === state.activeDirection
    );
    if (newWord) state.activeWordId = newWord.id;
    updateHighlights();
  }
  state.lastFocusedCell = { row, col };
}

function handleCellFocus(row, col) {
  const wordsInCell = state.cellToWordsMap.get(`${row}-${col}`) || [];
  if (wordsInCell.length === 0) {
    state.activeWordId = null;
  } else {
    const preferredWord = wordsInCell.find(
      (w) => w.direction === state.activeDirection
    );
    const currentWordInCell = wordsInCell.some(
      (w) => w.id === state.activeWordId
    );

    if (!currentWordInCell || preferredWord) {
      state.activeWordId = (preferredWord || wordsInCell[0]).id;
    }
  }
  updateHighlights();
  state.lastFocusedCell = { row, col };
}

// ============================================================================
// --- FUNÇÕES AUXILIARES E DE UI ---
// ============================================================================

function showScreen(screenName) {
  dom.welcomeScreen.classList.add("hidden");
  dom.gameContainer.classList.add("hidden");
  dom.endGameScreen.classList.add("hidden");
  if (screenName === "game") dom.gameContainer.classList.remove("hidden");
  else if (screenName === "end") dom.endGameScreen.classList.remove("hidden");
  else dom.welcomeScreen.classList.remove("hidden");
}

function resetClientState() {
  if (state.gameTimerInterval) clearInterval(state.gameTimerInterval);
  state = {
    ...state,
    gameId: null,
    currentGameState: null,
    activeWordId: null,
    activeDirection: "across",
    gameTimerInterval: null,
  };
  state.cellToWordsMap.clear();
}

function buildCellToWordsMap(words) {
  state.cellToWordsMap.clear();
  if (!words) return;
  words.forEach((word) => {
    for (let i = 0; i < word.length; i++) {
      const r =
        word.direction === "down"
          ? word.startPosition.row + i
          : word.startPosition.row;
      const c =
        word.direction === "across"
          ? word.startPosition.col + i
          : word.startPosition.col;
      const key = `${r}-${c}`;
      if (!state.cellToWordsMap.has(key)) state.cellToWordsMap.set(key, []);
      state.cellToWordsMap.get(key).push(word);
    }
  });
}

function updateHighlights() {
  document
    .querySelectorAll(".active-word, .focused")
    .forEach((el) => el.classList.remove("active-word", "focused"));

  if (state.activeWordId && state.currentGameState) {
    const words =
      state.currentGameState.gameMode === "versus" &&
      state.currentGameState.myState
        ? state.currentGameState.myState.words
        : state.currentGameState.words;
    if (words) {
      const activeWord = words.find((w) => w.id === state.activeWordId);
      if (activeWord) {
        for (let i = 0; i < activeWord.length; i++) {
          const r =
            activeWord.direction === "down"
              ? activeWord.startPosition.row + i
              : activeWord.startPosition.row;
          const c =
            activeWord.direction === "across"
              ? activeWord.startPosition.col + i
              : activeWord.startPosition.col;
          document
            .getElementById(`cell-${r}-${c}`)
            ?.classList.add("active-word");
        }
      }
    }
  }

  const focusedElement = document.activeElement;
  if (focusedElement?.matches(".cell-input")) {
    focusedElement.parentElement.classList.add("focused");
  }
}

function focusCell(row, col) {
  const input = document.querySelector(
    `input[data-row='${row}'][data-col='${col}']`
  );
  if (input && !input.disabled) {
    input.focus();
    input.select();
  }
}

// ============================================================================
// --- HANDLERS DE EVENTOS DO SOCKET.IO ---
// ============================================================================

socket.on("connect", () => {
  state.playerId = socket.id;
});

socket.on("gameState", (gameState) => {
  showScreen("game");
  render(gameState);
});

socket.on("gameCreated", ({ gameId, gameState }) => {
  resetClientState();
  state.gameId = gameId;
  showScreen("game");
  render(gameState);
});

socket.on("rematchStarted", ({ newGameId, newGameState }) => {
  resetClientState();
  state.gameId = newGameId;
  showScreen("game");
  render(newGameState);
});

socket.on("gameOver", ({ players, finalTime }) => {
  if (state.gameTimerInterval) clearInterval(state.gameTimerInterval);

  const minutes = Math.floor(finalTime / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (finalTime % 60).toString().padStart(2, "0");
  dom.finalTimeDisplay.textContent = `${minutes}:${seconds}`;

  dom.finalScoresList.innerHTML = "";
  players
    .sort((a, b) => b.score - a.score)
    .forEach((player) => {
      const li = document.createElement("li");
      li.textContent = `${player.name} ${player.isHost ? "👑" : ""}: ${
        player.score
      } pontos`;
      dom.finalScoresList.appendChild(li);
    });

  const self = players.find((p) => p.id === state.playerId);
  dom.rematchBtn.classList.toggle("hidden", !self?.isHost);
  dom.waitingForHostMsg.classList.toggle("hidden", self?.isHost);

  showScreen("end");
});

socket.on("gameError", ({ message }) => {
  dom.errorMessage.textContent = message;
  dom.errorMessage.classList.remove("hidden");
  setTimeout(() => dom.errorMessage.classList.add("hidden"), 3000);
});

socket.on("playCorrectSound", () => dom.sounds.correct.play().catch(() => {}));
socket.on("playWrongSound", () => dom.sounds.wrong.play().catch(() => {}));
socket.on("playAutoRevealSound", () =>
  dom.sounds.reveal.play().catch(() => {})
);

// ============================================================================
// --- INICIALIZAÇÃO ---
// ============================================================================

function initialize() {
  dom.createGameBtn.addEventListener("click", () => {
    const playerName = dom.playerNameInput.value;
    if (!playerName) return alert("Por favor, digite seu nome.");
    const gameMode = document.querySelector(
      'input[name="gameMode"]:checked'
    ).value;
    const numThemes = parseInt(dom.numThemesInput.value, 10);
    socket.emit("createGame", { playerName, gameMode, numThemes });
  });

  dom.joinGameBtn.addEventListener("click", () => {
    const playerName = dom.playerNameInput.value;
    const gameIdToJoin = dom.gameIdInput.value;
    if (!playerName || !gameIdToJoin)
      return alert("Preencha seu nome e o ID da sala.");
    state.gameId = gameIdToJoin;
    socket.emit("joinGame", { gameId: gameIdToJoin, playerName });
  });

  dom.lobbyBtn.addEventListener("click", () => window.location.reload());
  dom.rematchBtn.addEventListener("click", () =>
    socket.emit("rematch", { oldGameId: state.gameId })
  );

  dom.numThemesInput.addEventListener("input", (e) => {
    dom.numThemesValue.textContent = e.target.value;
  });
}

document.addEventListener("DOMContentLoaded", initialize);
