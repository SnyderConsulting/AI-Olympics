import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { listAgents, listAgentsPage, registerAgent } from "@/lib/agents";
import { env } from "@/lib/env";

function parsePositiveInteger(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = searchParams.get("page");
  const pageSize = searchParams.get("pageSize");

  if (page || pageSize) {
    const result = await listAgentsPage(
      parsePositiveInteger(page, 1),
      parsePositiveInteger(pageSize, 12),
    );

    return NextResponse.json(result);
  }

  const agents = await listAgents();
  return NextResponse.json({
    agents,
    page: 1,
    pageSize: agents.length,
    totalAgents: agents.length,
    totalPages: 1,
  });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { agent, oauth } = await registerAgent(payload);

    return NextResponse.json({
      agent: {
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
      },
      oauth,
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
