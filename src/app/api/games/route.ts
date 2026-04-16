import { NextResponse } from "next/server";

import { GAMES } from "@/lib/games";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ games: GAMES });
}
