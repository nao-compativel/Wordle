import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { GameState, Cell, Word } from "./types.js";

// --- CONFIGURAÇÕES DO GERADOR ---
const GRID_SIZE = 20;
const WORDS_TO_PLACE = 15;

// --- SETUP DE CAMINHOS (ESM) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dictionariesPath = path.join(__dirname, "..", "..", "dictionaries");

interface WordDefinition {
  word: string;
  clue: string;
}

function loadWords(themes: string[]): WordDefinition[] {
  let combinedWords: WordDefinition[] = [];

  themes.forEach((theme) => {
    const filePath = path.join(dictionariesPath, `${theme}.json`);
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const themeWords: WordDefinition[] = JSON.parse(fileContent);
      combinedWords.push(...themeWords);
    } else {
      console.warn(`Aviso: Dicionário para o tema "${theme}" não encontrado.`);
    }
  });

  if (combinedWords.length === 0) {
    throw new Error(
      `Nenhuma palavra encontrada para os temas: ${themes.join(", ")}`
    );
  }

  for (let i = combinedWords.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combinedWords[i], combinedWords[j]] = [
      combinedWords[j]!,
      combinedWords[i]!,
    ];
  }

  return combinedWords
    .slice(0, WORDS_TO_PLACE)
    .sort((a, b) => b.word.length - a.word.length);
}

export function generateBoard(themes: string[]): GameState {
  const themeName = themes.join(" + ");
  const wordList = loadWords(themes);
  const board: (Cell | null)[][] = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(null));
  const words: Word[] = [];
  let wordId = 1;

  const firstWord = wordList.shift();
  if (!firstWord) {
    return {
      board,
      words,
      players: [],
      theme: themeName,
      endTime: 0,
      gameMode: "normal",
      durationInSeconds: 0,
    };
  }

  const startRow = Math.floor(GRID_SIZE / 2);
  const startCol = Math.floor((GRID_SIZE - firstWord.word.length) / 2);
  placeWord(firstWord, "across", startRow, startCol);

  let wordDef: WordDefinition | undefined;
  while ((wordDef = wordList.shift()) !== undefined) {
    const currentWordDef = wordDef;
    let bestPlacement = null;
    let maxIntersections = -1;

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const currentCell = board[r]?.[c];
        if (currentCell) {
          for (let i = 0; i < currentWordDef.word.length; i++) {
            const letter = currentWordDef.word[i]?.toUpperCase();
            if (letter && letter === currentCell.correctLetter) {
              const intersectionsH = countIntersections(
                currentWordDef.word,
                "across",
                r,
                c - i
              );
              if (
                intersectionsH > maxIntersections &&
                canPlaceWord(currentWordDef.word, "across", r, c - i)
              ) {
                maxIntersections = intersectionsH;
                bestPlacement = {
                  wordDef: currentWordDef,
                  dir: "across" as const,
                  row: r,
                  col: c - i,
                };
              }

              const intersectionsV = countIntersections(
                currentWordDef.word,
                "down",
                r - i,
                c
              );
              if (
                intersectionsV > maxIntersections &&
                canPlaceWord(currentWordDef.word, "down", r - i, c)
              ) {
                maxIntersections = intersectionsV;
                bestPlacement = {
                  wordDef: currentWordDef,
                  dir: "down" as const,
                  row: r - i,
                  col: c,
                };
              }
            }
          }
        }
      }
    }
    if (bestPlacement) {
      placeWord(
        bestPlacement.wordDef,
        bestPlacement.dir,
        bestPlacement.row,
        bestPlacement.col
      );
    }
  }

  let minRow = GRID_SIZE,
    maxRow = -1,
    minCol = GRID_SIZE,
    maxCol = -1;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (board[r]?.[c]) {
        if (r < minRow) minRow = r;
        if (r > maxRow) maxRow = r;
        if (c < minCol) minCol = c;
        if (c > maxCol) maxCol = c;
      }
    }
  }

  if (maxRow === -1) {
    return {
      board,
      words: words.sort((a, b) => a.id - b.id),
      players: [],
      theme: themeName,
      endTime: 0,
      gameMode: "normal",
      durationInSeconds: 0,
    };
  }

  const croppedBoard = board.slice(minRow, maxRow + 1).map((row) => {
    return row.slice(minCol, maxCol + 1);
  });

  const adjustedWords = words.map((word) => ({
    ...word,
    startPosition: {
      row: word.startPosition.row - minRow,
      col: word.startPosition.col - minCol,
    },
  }));

  // --- Funções Auxiliares ---
  function placeWord(
    wordDef: WordDefinition,
    direction: "across" | "down",
    row: number,
    col: number
  ) {
    const wordStr = wordDef.word.toUpperCase();
    for (let i = 0; i < wordStr.length; i++) {
      const r = direction === "across" ? row : row + i;
      const c = direction === "across" ? col + i : col;
      const letter = wordStr[i];
      const rowArray = board[r];

      if (rowArray && letter) {
        if (letter === "_") {
          rowArray[c] = {
            correctLetter: "_",
            currentLetter: "_",
            placedBy: "SYSTEM",
          };
        } else {
          rowArray[c] = {
            correctLetter: letter,
            currentLetter: "",
            placedBy: null,
          };
        }
      }
    }
    words.push({
      id: wordId++,
      clue: wordDef.clue,
      direction,
      startPosition: { row, col },
      length: wordStr.length,
    });
  }

  function canPlaceWord(
    wordStr: string,
    direction: "across" | "down",
    row: number,
    col: number
  ): boolean {
    if (row < 0 || col < 0) return false;
    const len = wordStr.length;
    if (direction === "across" && col + len > GRID_SIZE) return false;
    if (direction === "down" && row + len > GRID_SIZE) return false;

    for (let i = 0; i < len; i++) {
      let r = row,
        c = col;
      if (direction === "across") c += i;
      else r += i;

      const letter = wordStr[i]?.toUpperCase();
      if (!letter) continue;

      const rowArray = board[r];
      if (!rowArray) return false;

      const isIntersection = rowArray[c]?.correctLetter === letter;
      // Permite sobrepor se for uma interseção, mas não permite sobrepor uma célula de espaço com uma letra (ou vice-versa)
      if (rowArray[c] && !isIntersection) return false;

      // Adjacency check only for letter cells, not space cells
      if (!isIntersection && letter !== "_") {
        if (direction === "across") {
          if (board[r - 1]?.[c] || board[r + 1]?.[c]) return false;
        } else {
          if (rowArray[c - 1] || rowArray[c + 1]) return false;
        }
      }
    }

    // Check before start and after end
    if (direction === "across") {
      if (board[row]?.[col - 1] || board[row]?.[col + len]) return false;
    } else {
      if (board[row - 1]?.[col] || board[row + len]?.[col]) return false;
    }
    return true;
  }

  function countIntersections(
    wordStr: string,
    direction: "across" | "down",
    row: number,
    col: number
  ): number {
    let count = 0;
    for (let i = 0; i < wordStr.length; i++) {
      let r = row,
        c = col;
      if (direction === "across") c += i;
      else r += i;
      const letter = wordStr[i]?.toUpperCase();
      if (board[r]?.[c]?.correctLetter === letter) {
        count++;
      }
    }
    return count;
  }

  return {
    board: croppedBoard,
    words: adjustedWords.sort((a, b) => a.id - b.id),
    players: [],
    theme: themeName,
    endTime: 0,
    gameMode: "normal",
    durationInSeconds: 0,
  };
}
