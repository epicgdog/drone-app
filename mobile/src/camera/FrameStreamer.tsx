import type { CameraView } from "expo-camera";
import { File } from "expo-file-system";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import { PoseMessage, PoseSocket } from "../net/poseSocket";

const TARGET_MIN_WIDTH = 640;
const ERROR_BACKOFF_MS = 100;
const JPEG_QUALITY = 0.6;

/**
 * Smallest picture size whose width is >= 640, or the largest available if none
 * qualifies. iOS reports `WxH` strings (e.g. "640x480") plus named presets such
 * as "Photo"/"High"; presets are ignored because their size is unknown.
 */
export function pickPictureSize(sizes: string[]): string | undefined {
  const parsed = sizes
    .map((s) => {
      const match = /^(\d+)x(\d+)$/.exec(s);
      if (!match) return null;
      const [w, h] = [Number(match[1]), Number(match[2])];
      return { s, long: Math.max(w, h) };
    })
    .filter((p): p is { s: string; long: number } => p !== null);
  if (parsed.length === 0) return undefined;

  const wideEnough = parsed.filter((p) => p.long >= TARGET_MIN_WIDTH);
  if (wideEnough.length > 0) {
    return wideEnough.reduce((a, b) => (a.long <= b.long ? a : b)).s;
  }
  return parsed.reduce((a, b) => (a.long >= b.long ? a : b)).s;
}

interface FrameStreamerProps {
  cameraRef: RefObject<CameraView | null>;
  /** True only once the camera has fired `onCameraReady` and the socket is connected. */
  active: boolean;
  socket: PoseSocket;
  onPoseMessage?: (msg: PoseMessage) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Non-visual: runs the single-in-flight capture → send → await loop while `active`. */
export function FrameStreamer({
  cameraRef,
  active,
  socket,
  onPoseMessage,
}: FrameStreamerProps) {
  const frameIdRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    let stopped = false;

    const loop = async () => {
      while (!stopped) {
        const camera = cameraRef.current;
        if (!camera) {
          await sleep(100);
          continue;
        }

        let capturedUri: string | null = null;
        try {
          const picture = await camera.takePictureAsync({
            quality: JPEG_QUALITY,
            shutterSound: false,
          });
          capturedUri = picture.uri;

          const buffer = await new File(capturedUri).arrayBuffer();
          frameIdRef.current += 1;
          const msg = await socket.sendFrame(frameIdRef.current, buffer);
          if (msg && onPoseMessage) onPoseMessage(msg);
        } catch (err) {
          // Transient capture/send failure: back off briefly so the loop can't spin.
          console.warn("Frame capture/send failed", err);
          await sleep(ERROR_BACKOFF_MS);
        } finally {
          if (capturedUri) {
            try {
              new File(capturedUri).delete();
            } catch {
              // Best-effort cleanup.
            }
          }
        }
      }
    };

    loop();
    return () => {
      stopped = true;
    };
  }, [active, cameraRef, socket, onPoseMessage]);

  return null;
}
