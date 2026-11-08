import { isSecretAppStateKey } from "./secret-key.ts";

const HOSTED = /railway|rlwy\.net|neon\.tech|supabase|amazonaws|stacks-production/i;

export type AssignmentTarget = {
  provider: string;
  subject: string;
  email: string | null;
};

export type AssignmentPlan = {
  userId: string;
  provider: string;
  subject: string;
  email: string | null;
  bookIds: string[];
  settingKeys: string[];
  appStateCount: number;
};

type Sql = {
  query: <T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

export function assertSafeAssignmentTarget(databaseUrl: string, env: NodeJS.ProcessEnv): void {
  if (!databaseUrl.trim()) throw new Error("DATABASE_URL is required");
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing legacy assignment when NODE_ENV is production");
  }
  if (
    env.RAILWAY_ENVIRONMENT ||
    env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_PUBLIC_DOMAIN ||
    env.RAILWAY_STATIC_URL
  ) {
    throw new Error("Refusing legacy assignment in a hosted environment");
  }
  let host = "";
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a URL");
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Refusing legacy assignment against a non-local database");
  }
  if (HOSTED.test(databaseUrl)) {
    throw new Error("Refusing legacy assignment against a hosted database");
  }
}

export function assignmentTarget(env: NodeJS.ProcessEnv): AssignmentTarget {
  const subject = env.STACKS_LEGACY_OWNER_SUBJECT?.trim() ?? "";
  const provider = env.STACKS_LEGACY_OWNER_PROVIDER?.trim() || "google";
  const email = env.STACKS_LEGACY_OWNER_EMAIL?.trim() || null;
  if (!subject) {
    throw new Error(
      "STACKS_LEGACY_OWNER_SUBJECT is required. The Google subject is the owner key, not an email address.",
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(subject)) {
    throw new Error("STACKS_LEGACY_OWNER_SUBJECT contains unsupported characters");
  }
  if (!/^[a-z0-9-]{1,64}$/.test(provider)) {
    throw new Error("STACKS_LEGACY_OWNER_PROVIDER must be a provider id such as google");
  }
  return { provider, subject, email };
}

async function verifiedUser(client: Sql, target: AssignmentTarget) {
  const result = await client.query<{
    id: string;
    email: string | null;
    verified: boolean;
  }>(
    `SELECT u.id, u.email, (u."emailVerified" IS NOT NULL) AS verified
     FROM users u
     JOIN accounts a ON a."userId" = u.id
     WHERE a.provider = $1 AND a."providerAccountId" = $2`,
    [target.provider, target.subject],
  );
  if (result.rows.length !== 1) {
    throw new Error(
      "No single verified account matches that provider and subject. Sign in once, then assign. Email is not used as the lookup key.",
    );
  }
  const user = result.rows[0];
  if (!user.verified) {
    throw new Error("The matching account has no verified sign-in timestamp. Nothing was assigned.");
  }
  if (target.email && user.email?.toLowerCase() !== target.email.toLowerCase()) {
    throw new Error(
      "STACKS_LEGACY_OWNER_EMAIL does not match the account for that subject. Nothing was assigned.",
    );
  }
  return user;
}

export async function planLegacyAssignment(
  client: Sql,
  target: AssignmentTarget,
): Promise<AssignmentPlan> {
  const user = await verifiedUser(client, target);
  const books = await client.query<{ id: string }>(
    "SELECT id FROM books WHERE owner_id IS NULL ORDER BY created_at ASC, id ASC",
  );
  const settings = await client.query<{ key: string }>(
    "SELECT key FROM app_state ORDER BY key ASC",
  );
  const count = await client.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM app_state");
  return {
    userId: user.id,
    provider: target.provider,
    subject: target.subject,
    email: user.email,
    bookIds: books.rows.map((row) => row.id),
    settingKeys: settings.rows.map((row) => row.key).filter((key) => !isSecretAppStateKey(key)),
    appStateCount: Number(count.rows[0]?.n ?? 0),
  };
}

export async function applyLegacyAssignment(
  client: Sql,
  target: AssignmentTarget,
): Promise<AssignmentPlan & { assignedBooks: number; copiedSettings: number; remainingUnassigned: number }> {
  await client.query("BEGIN");
  try {
    const plan = await planLegacyAssignment(client, target);
    const assigned = await client.query(
      "UPDATE books SET owner_id = $1 WHERE owner_id IS NULL",
      [plan.userId],
    );
    let copiedSettings = 0;
    if (plan.settingKeys.length > 0) {
      const settings = await client.query<{ key: string; value: string }>(
        "SELECT key, value FROM app_state ORDER BY key ASC",
      );
      for (const row of settings.rows) {
        if (!plan.settingKeys.includes(row.key)) continue;
        const inserted = await client.query(
          `INSERT INTO user_settings (user_id, key, value)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, key) DO NOTHING`,
          [plan.userId, row.key, row.value],
        );
        copiedSettings += inserted.rowCount ?? 0;
      }
    }
    const remaining = await client.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM books WHERE owner_id IS NULL",
    );
    const appState = await client.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM app_state");
    if (Number(appState.rows[0]?.n ?? 0) !== plan.appStateCount) {
      throw new Error("Legacy app_state changed during assignment. Rolled back.");
    }
    await client.query("COMMIT");
    return {
      ...plan,
      assignedBooks: assigned.rowCount ?? 0,
      copiedSettings,
      remainingUnassigned: Number(remaining.rows[0]?.n ?? 0),
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original failure.
    }
    throw error;
  }
}
