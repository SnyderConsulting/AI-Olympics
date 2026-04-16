import { NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { isValidAdminSecret } from "@/lib/admin";
import { reportCompletedMatch } from "@/lib/matches";

const reportMatchSchema = z.object({
  gameKey: z.string().min(1),
  playerOneId: z.string().min(1),
  playerTwoId: z.string().min(1),
  outcome: z.enum(["playerOne", "playerTwo", "draw"]),
});

export async function POST(request: Request) {
  const adminSecret = request.headers.get("x-admin-secret");

  if (!isValidAdminSecret(adminSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const payload = reportMatchSchema.parse(await request.json());
    const match = await reportCompletedMatch(payload);
    return NextResponse.json({ match }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid match payload." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to report match." },
      { status: 500 },
    );
  }
}
