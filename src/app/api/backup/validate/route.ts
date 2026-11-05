import { NextResponse } from "next/server";
import {
  backupFailure,
  destinationNeedsReplace,
  getDestinationCounts,
  publicValidation,
  readJsonLimited,
  validateBackupData,
} from "@/lib/backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readJsonLimited(request);
    const validation = validateBackupData(body);
    const destination = await getDestinationCounts();
    const warnings = [...validation.warnings];
    if (destinationNeedsReplace(destination)) {
      warnings.push(
        `This shelf already has ${destination.bookCount} books and ${destination.appStateCount} settings. Nothing will be overwritten unless you explicitly confirm replacement.`,
      );
    }
    return NextResponse.json({
      ...publicValidation(validation),
      warnings,
      destination,
      requiresReplace: destinationNeedsReplace(destination),
    });
  } catch (error) {
    const failure = backupFailure(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
