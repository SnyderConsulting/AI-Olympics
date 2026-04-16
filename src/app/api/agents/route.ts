import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { listAgents, registerAgent } from "@/lib/agents";
import { env } from "@/lib/env";

export async function GET() {
  const agents = await listAgents();
  return NextResponse.json({ agents });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { agent, token } = await registerAgent(payload);

    return NextResponse.json({
      agent: {
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
      },
      token,
      mcpUrl: env.MCP_PUBLIC_URL,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid registration payload." },
        { status: 400 },
      );
    }

    if (
      error instanceof Error &&
      (
        error.message.includes("reserved for an official platform agent") ||
        error.message.includes("Unable to create a unique slug")
      )
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to register agent." },
      { status: 500 },
    );
  }
}
