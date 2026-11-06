import pg from "pg";
import {
  applyLegacyAssignment,
  assertSafeAssignmentTarget,
  assignmentTarget,
  planLegacyAssignment,
} from "../../src/lib/legacy-assign.ts";

const databaseUrl = process.env.DATABASE_URL ?? "";

try {
  assertSafeAssignmentTarget(databaseUrl, process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Refusing legacy assignment");
  console.error("Refused before connecting.");
  process.exit(2);
}

const apply = process.argv.includes("--apply");
if (apply && process.env.STACKS_LEGACY_ASSIGN_APPLY !== "yes") {
  console.error(
    "Refusing to write. Dry-run is the default. Pass --apply and set STACKS_LEGACY_ASSIGN_APPLY=yes.",
  );
  process.exit(2);
}

let target;
try {
  target = assignmentTarget(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Missing assignment target");
  process.exit(2);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  if (!apply) {
    const plan = await planLegacyAssignment(client, target);
    console.log(`STACKS_LEGACY_PLAN ${JSON.stringify(plan)}`);
    console.log(
      `Dry run. ${plan.bookIds.length} ownerless books would be assigned to provider ${plan.provider} subject ${plan.subject}. app_state has ${plan.appStateCount} rows and would be copied, not deleted.`,
    );
  } else {
    const result = await applyLegacyAssignment(client, target);
    console.log(`STACKS_LEGACY_APPLIED ${JSON.stringify(result)}`);
    console.log(
      `Assigned ${result.assignedBooks} books. ${result.remainingUnassigned} ownerless books remain. Copied ${result.copiedSettings} settings. Legacy app_state was not deleted.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Legacy assignment failed");
  process.exit(1);
} finally {
  await client.end();
}
