import { type GameKey } from "@/lib/games";
import {
  createInitialCheckersState,
  getCheckersPlayerLabel,
  parseCheckersState,
  renderCheckersBoard,
  serializeCheckersState,
} from "@/lib/checkers";
import {
  boardToAscii,
  createInitialTicTacToeState,
  parseTicTacToeState,
  serializeTicTacToeState,
} from "@/lib/tic-tac-toe";

export function createInitialMatchState(gameKey: GameKey) {
  switch (gameKey) {
    case "tic-tac-toe": {
      const state = createInitialTicTacToeState();
      return {
        stateJson: serializeTicTacToeState(state),
        board: boardToAscii(state.board),
        playerOneRoleLabel: "X",
        playerTwoRoleLabel: "O",
      };
    }
    case "checkers": {
      const state = createInitialCheckersState();
      return {
        stateJson: serializeCheckersState(state),
        board: renderCheckersBoard(state.board),
        playerOneRoleLabel: getCheckersPlayerLabel("RED"),
        playerTwoRoleLabel: getCheckersPlayerLabel("BLACK"),
      };
    }
  }
}

export function renderSerializedGameBoard(gameKey: string, stateJson: string): string | null {
  try {
    switch (gameKey) {
      case "tic-tac-toe":
        return boardToAscii(parseTicTacToeState(stateJson).board);
      case "checkers":
        return renderCheckersBoard(parseCheckersState(stateJson).board);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
