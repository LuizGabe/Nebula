export function formatAudioTag(timestampMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `[audio:${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}]`;
  }

  return `[audio:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}]`;
}
