"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { looksLikeIsbn, normalizeIsbn } from "@/lib/isbn";

type BarcodeDetectorLike = {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

export function ScanIsbn({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (isbn: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [manual, setManual] = useState("");
  const [status, setStatus] = useState("Starting camera…");
  const [error, setError] = useState("");
  const handled = useRef(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!open) return;

    handled.current = false;
    setManual("");
    setError("");
    setStatus("Starting camera…");

    const video = videoRef.current;
    if (!video) return;

    let stream: MediaStream | undefined;
    let stopped = false;
    let raf = 0;
    let foundTimer = 0;
    let zxingStop: { stop: () => void } | undefined;

    function accept(raw: string) {
      const isbn = normalizeIsbn(raw);
      if (!isbn || handled.current || stopped) return false;
      handled.current = true;
      setStatus(`Found ${isbn}`);
      foundTimer = window.setTimeout(() => onDetectedRef.current(isbn), 800);
      return true;
    }

    async function startDetector(target: HTMLVideoElement) {
      if (!window.BarcodeDetector) return;
      try {
        const detector = new window.BarcodeDetector({
          formats: ["ean_13", "ean_8", "code_128", "upc_a", "upc_e"],
        });
        setStatus("Point the camera at an ISBN barcode");
        const tick = async () => {
          if (stopped || handled.current) return;
          try {
            if (target.readyState >= 2) {
              const codes = await detector.detect(target);
              for (const code of codes) {
                if (accept(code.rawValue)) return;
              }
            }
          } catch {
            // Keep scanning; some frames are not readable.
          }
          raf = requestAnimationFrame(() => {
            void tick();
          });
        };
        void tick();
      } catch {
        // Fall through to ZXing.
      }
    }

    async function startZxing(target: HTMLVideoElement) {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        setStatus("Point the camera at an ISBN barcode");
        const controls = await reader.decodeFromVideoElement(target, (result) => {
          if (result) accept(result.getText());
        });
        zxingStop = controls;

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        const pulse = window.setInterval(() => {
          if (stopped || handled.current || !context || target.readyState < 2) return;
          if (!target.videoWidth || !target.videoHeight) return;
          canvas.width = target.videoWidth;
          canvas.height = target.videoHeight;
          context.drawImage(target, 0, 0);
          try {
            accept(reader.decodeFromCanvas(canvas).getText());
          } catch {
            // Frame had no readable barcode.
          }
        }, 250);
        const previousStop = zxingStop.stop.bind(zxingStop);
        zxingStop.stop = () => {
          window.clearInterval(pulse);
          previousStop();
        };
      } catch {
        if (!window.BarcodeDetector) {
          setError("This browser cannot scan barcodes. Enter the ISBN instead.");
        }
      }
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        const target = videoRef.current;
        if (stopped || !target) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        targetSrc(target, stream);
        await target.play();
        await Promise.all([startDetector(target), startZxing(target)]);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Camera permission was denied.";
        setError(message);
        setStatus("Camera unavailable. Enter the ISBN instead.");
      }
    }

    void start();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(foundTimer);
      zxingStop?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (video) {
        video.srcObject = null;
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      data-testid="scan-overlay"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-medium">Scan ISBN</p>
        <Button type="button" variant="ghost" className="text-white hover:bg-white/10" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="relative mx-4 min-h-0 flex-1 overflow-hidden rounded-2xl bg-neutral-900">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          autoPlay
          data-testid="scan-video"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-28 w-[78%] rounded-lg border-2 border-white/80" />
        </div>
      </div>
      <div className="space-y-3 px-4 py-4">
        <p className="text-center text-sm text-white/80" data-testid="scan-status">
          {status}
        </p>
        {error ? (
          <p className="text-center text-sm text-red-300" data-testid="scan-error">
            {error}
          </p>
        ) : null}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!looksLikeIsbn(manual)) {
              setError("Enter a valid ISBN-10 or ISBN-13.");
              return;
            }
            const isbn = normalizeIsbn(manual);
            if (isbn) onDetected(isbn);
          }}
        >
          <Input
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="Or type the ISBN"
            className="bg-white text-black"
            data-testid="manual-isbn"
            inputMode="numeric"
          />
          <Button type="submit" variant="secondary" data-testid="manual-isbn-submit">
            Use
          </Button>
        </form>
      </div>
    </div>
  );
}

function targetSrc(video: HTMLVideoElement, stream: MediaStream) {
  video.srcObject = stream;
}
