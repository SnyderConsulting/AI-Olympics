import { spawn } from "node:child_process";

export type StockfishLegalMove = {
  notation: string;
  lan: string;
  from: string;
  to: string;
  promotion: string | null;
};

export async function requestStockfishBestmove(args: {
  binaryPath: string;
  fen: string;
  movetimeMs: number;
  threads: number;
  hashMb: number;
  timeoutMs?: number;
}) {
  const timeoutMs = args.timeoutMs ?? Math.max(args.movetimeMs + 2_000, 5_000);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(args.binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let phase: "uci" | "ready" | "search" = "uci";
    let stdoutRemainder = "";
    let stderr = "";
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const fail = (error: Error) => {
      finish(() => {
        child.kill("SIGKILL");
        reject(error);
      });
    };

    const succeed = (bestmove: string) => {
      finish(() => {
        child.stdin.end("quit\n");
        resolve(bestmove);
      });
    };

    const timeout = setTimeout(() => {
      fail(
        new Error(
          `Stockfish did not return a move within ${timeoutMs}ms.` +
            (stderr.trim() ? ` stderr: ${stderr.trim()}` : ""),
        ),
      );
    }, timeoutMs);

    child.on("error", (error) => {
      fail(
        new Error(
          `Failed to start Stockfish at ${args.binaryPath}: ${error.message}`,
        ),
      );
    });

    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }

      fail(
        new Error(
          `Stockfish exited before returning a move.` +
            ` code=${code ?? "null"} signal=${signal ?? "null"}` +
            (stderr.trim() ? ` stderr: ${stderr.trim()}` : ""),
        ),
      );
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutRemainder += chunk.toString();
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line) {
          continue;
        }

        if (phase === "uci" && line === "uciok") {
          child.stdin.write(`setoption name Threads value ${args.threads}\n`);
          child.stdin.write(`setoption name Hash value ${args.hashMb}\n`);
          child.stdin.write("isready\n");
          phase = "ready";
          continue;
        }

        if (phase === "ready" && line === "readyok") {
          child.stdin.write("ucinewgame\n");
          child.stdin.write(`position fen ${args.fen}\n`);
          child.stdin.write(`go movetime ${args.movetimeMs}\n`);
          phase = "search";
          continue;
        }

        if (phase !== "search") {
          continue;
        }

        const bestmove = extractStockfishBestmove(line);

        if (bestmove) {
          succeed(bestmove);
          return;
        }
      }
    });

    child.stdin.write("uci\n");
  });
}

export function extractStockfishBestmove(line: string) {
  const match = line.trim().match(/^bestmove\s+(\S+)/i);

  if (!match) {
    return null;
  }

  const bestmove = match[1].trim();

  if (!bestmove || bestmove === "(none)" || bestmove === "none") {
    throw new Error("Stockfish did not return a legal move.");
  }

  return bestmove;
}

export function resolveStockfishMoveNotation(
  bestmove: string,
  legalMoves: readonly StockfishLegalMove[],
) {
  const normalized = normalizeBestmove(bestmove);
  const matchingMove = legalMoves.find((move) => {
    return (
      normalizeBestmove(move.lan) === normalized ||
      normalizeBestmove(
        `${move.from}${move.to}${move.promotion?.toLowerCase() ?? ""}`,
      ) === normalized
    );
  });

  if (!matchingMove) {
    throw new Error(
      `Stockfish bestmove ${bestmove} was not present in the legal move list.`,
    );
  }

  return matchingMove.notation;
}

function normalizeBestmove(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
