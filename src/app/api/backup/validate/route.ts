import {
  backupFailure,
  destinationNeedsReplace,
  getDestinationCounts,
  publicValidation,
  readJsonLimited,
  validateBackupData,
} from "@/lib/backup";
import { AuthError, assertSameOrigin, privateJson } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await readJsonLimited(request);
    const validation = validateBackupData(body);
    const destination = await getDestinationCounts(user.id);
    const warnings = [...validation.warnings];
    if (destinationNeedsReplace(destination)) {
      warnings.push(
        `This shelf already has ${destination.bookCount} books and ${destination.appStateCount} settings. Nothing will be overwritten unless you explicitly confirm replacement.`,
      );
    }
    return privateJson({
      ...publicValidation(validation),
      warnings,
      destination,
      requiresReplace: destinationNeedsReplace(destination),
    });
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    const failure = backupFailure(error);
    return privateJson(failure.body, failure.status);
  }
}
