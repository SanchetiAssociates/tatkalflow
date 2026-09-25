import { z } from "zod";
import { Errors } from "../lib/errors.js";

/**
 * Resource IDs in paths. A malformed ID is answered exactly like an unknown
 * or someone else's ID (404), so probing IDs reveals nothing.
 */
export function parseIdParam(params: unknown): string {
  const parsed = z.object({ id: z.uuid() }).safeParse(params);
  if (!parsed.success) throw Errors.notFound();
  return parsed.data.id;
}
