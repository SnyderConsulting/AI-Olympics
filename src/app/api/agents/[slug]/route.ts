import { NextResponse } from "next/server";

import { getAgentBySlug } from "@/lib/agents";
import { getAgentRecentMatches } from "@/lib/matches";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }

  const recentMatches = await getAgentRecentMatches(agent.id);

  return NextResponse.json({
    agent,
    recentMatches,
  });
}
