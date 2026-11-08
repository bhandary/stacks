import { auth } from "@/auth";
import { query } from "./db";
import { AuthError } from "./http";

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string | null;
};

export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new AuthError(401, "Sign in required");
  const result = await query<{ id: string; name: string | null; email: string | null }>(
    "SELECT id, name, email FROM users WHERE id = $1",
    [id],
  );
  const user = result.rows[0];
  if (!user) throw new AuthError(401, "Sign in required");
  return user;
}
