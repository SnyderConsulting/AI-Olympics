import { env } from "@/lib/env";

export function isValidAdminSecret(secret: string | null): boolean {
  return secret === env.COMPETITION_ADMIN_SECRET;
}
