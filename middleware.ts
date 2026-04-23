import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const WWW_HOST = "www.ai-olympics.live";
const CANONICAL_HOST = "ai-olympics.live";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host");

  if (host !== WWW_HOST) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.protocol = "https:";
  url.host = CANONICAL_HOST;

  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: "/:path*",
};
