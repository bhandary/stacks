"use client";

import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { AlertCircle, CheckCircle2, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ValidationResponse = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  requiresReplace?: boolean;
  destination?: { bookCount: number; appStateCount: number };
  preview?: {
    version: string;
    createdAt: string;
    bookCount: number;
    appStateCount: number;
    exampleBookCount: number;
  };
};

type BackupRestoreProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: () => void;
};

export function BackupRestore({ open, onOpenChange, onRestored }: BackupRestoreProps) {
  const [downloading, setDownloading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [backupData, setBackupData] = useState<unknown>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreLock = useRef(false);

  const reset = useCallback(() => {
    setValidation(null);
    setBackupData(null);
    setReplaceConfirmed(false);
    setError("");
    setSuccess("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  function handleOpenChange(next: boolean) {
    if (!next && !restoring) reset();
    if (!restoring) onOpenChange(next);
  }

  async function downloadBackup() {
    setError("");
    setSuccess("");
    setDownloading(true);
    try {
      const response = await fetch("/api/backup");
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Could not download the backup");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const match = response.headers
        .get("content-disposition")
        ?.match(/filename="([^"]+)"/);
      link.href = url;
      link.download = match?.[1] || "stacks-backup.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setSuccess("Backup downloaded. Store that file somewhere safe.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not download the backup");
    } finally {
      setDownloading(false);
    }
  }

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError("");
    setSuccess("");
    setValidation(null);
    setBackupData(null);
    setReplaceConfirmed(false);
    if (!file) return;

    setValidating(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setError("This file is not valid JSON. The shelf was not changed.");
        return;
      }
      setBackupData(parsed);
      const response = await fetch("/api/backup/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const result = (await response.json().catch(() => ({}))) as ValidationResponse & {
        error?: string;
      };
      if (!response.ok) {
        setBackupData(null);
        setError(result.error || "Could not validate that backup. The shelf was not changed.");
        return;
      }
      setValidation(result);
    } catch (cause) {
      setBackupData(null);
      setError(cause instanceof Error ? cause.message : "Could not read that file");
    } finally {
      setValidating(false);
    }
  }

  async function confirmRestore() {
    if (restoreLock.current || !backupData || !validation?.valid) return;
    if (validation.requiresReplace && !replaceConfirmed) return;
    restoreLock.current = true;
    setRestoring(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          replace: validation.requiresReplace === true,
          backup: backupData,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: string[];
        restored?: { books: number; appState: number };
      };
      if (!response.ok) {
        throw new Error(
          [result.error, ...(result.details ?? [])].filter(Boolean).join(" "),
        );
      }
      setSuccess(
        `Restored ${result.restored?.books ?? 0} books and ${result.restored?.appState ?? 0} settings.`,
      );
      setValidation(null);
      setBackupData(null);
      setReplaceConfirmed(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onRestored();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Restore failed. The shelf was left as it was.");
    } finally {
      restoreLock.current = false;
      setRestoring(false);
    }
  }

  const requiresReplace = Boolean(validation?.valid && validation.requiresReplace);
  const canConfirm = Boolean(validation?.valid && backupData) && (!requiresReplace || replaceConfirmed);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="backup-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Backup and restore</DialogTitle>
          <DialogDescription>
            Download every book and shelf setting, or replace this shelf from a backup file.
            This is a manual copy of your library, not an automatic database backup.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Download backup</h2>
            <p className="text-xs text-stone-500">
              Titles, notes, ratings, ISBNs, timestamps, and settings. Cover pictures stay
              as links. Passwords and server settings are not included.
            </p>
            <Button
              type="button"
              variant="outline"
              data-testid="backup-download"
              disabled={downloading || restoring}
              onClick={() => void downloadBackup()}
            >
              <Download className="size-4" />
              {downloading ? "Preparing…" : "Download backup"}
            </Button>
          </section>

          <section className="flex flex-col gap-2 border-t pt-4">
            <h2 className="text-sm font-medium">Restore from a file</h2>
            <p className="text-xs text-stone-500">
              Choosing a file only checks it. Nothing is written until you confirm. If this
              shelf already has data, you must agree to replace it.
            </p>
            <label className="text-xs font-medium" htmlFor="backup-file">
              Backup file
            </label>
            <input
              id="backup-file"
              ref={fileInputRef}
              data-testid="backup-file"
              type="file"
              accept="application/json,.json"
              disabled={validating || restoring}
              onChange={(event) => void handleFileSelect(event)}
              className="block w-full text-xs text-stone-600 file:mr-3 file:rounded-full file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-xs file:font-medium file:text-stone-900"
            />
            {validating ? (
              <p className="text-xs text-stone-500" data-testid="backup-validating">
                Checking the file…
              </p>
            ) : null}

            {validation ? (
              <div
                className="rounded-lg border p-3"
                data-testid={validation.valid ? "backup-preview" : "backup-invalid"}
              >
                {validation.valid && validation.preview ? (
                  <div className="flex items-start gap-2 text-sm text-green-800">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    <div className="space-y-1 text-xs text-stone-700">
                      <p className="font-medium text-green-800">Backup looks valid</p>
                      <p>Version {validation.preview.version}</p>
                      <p>
                        {validation.preview.bookCount}{" "}
                        {validation.preview.bookCount === 1 ? "book" : "books"}
                        {validation.preview.exampleBookCount > 0
                          ? ` (${validation.preview.exampleBookCount} examples)`
                          : ""}
                        {" · "}
                        {validation.preview.appStateCount}{" "}
                        {validation.preview.appStateCount === 1 ? "setting" : "settings"}
                      </p>
                      <p>Taken {new Date(validation.preview.createdAt).toLocaleString()}</p>
                      {validation.destination ? (
                        <p>
                          This shelf currently has {validation.destination.bookCount} books and{" "}
                          {validation.destination.appStateCount} settings.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-medium">This file cannot be restored</p>
                      {validation.errors.map((item) => (
                        <p key={item} className="text-xs">
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {validation.warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-amber-800" data-testid="backup-warnings">
                    {validation.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {requiresReplace ? (
              <label className="flex items-start gap-2 text-xs text-stone-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  data-testid="backup-replace-confirm"
                  checked={replaceConfirmed}
                  disabled={restoring}
                  onChange={(event) => setReplaceConfirmed(event.target.checked)}
                />
                <span>
                  Replace the current shelf with this backup. Books and settings that are only
                  on this shelf will be deleted. This cannot be undone.
                </span>
              </label>
            ) : null}
          </section>

          {error ? (
            <p className="flex items-start gap-2 text-sm text-destructive" data-testid="backup-error" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </p>
          ) : null}
          {success ? (
            <p className="flex items-start gap-2 text-sm text-green-800" data-testid="backup-success" role="status">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>{success}</span>
            </p>
          ) : null}
        </div>

        {validation?.valid ? (
          <DialogFooter>
            <Button type="button" variant="outline" disabled={restoring} onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={requiresReplace ? "destructive" : "default"}
              data-testid="backup-confirm"
              disabled={!canConfirm || restoring}
              onClick={() => void confirmRestore()}
            >
              <Upload className="size-4" />
              {restoring
                ? "Restoring…"
                : requiresReplace
                  ? "Replace shelf with backup"
                  : "Restore into this empty shelf"}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
