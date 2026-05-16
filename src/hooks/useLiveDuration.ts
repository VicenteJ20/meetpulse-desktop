import { useEffect, useState } from 'react';

export function useLiveDuration(
  snapshot: {
    status: string;
    recording_id?: string | null;
    duration_ms: number;
  } | null,
  now: number,
): number {
  const [anchor, setAnchor] = useState({ at: now, duration: 0, recordingId: '', status: 'idle' });

  useEffect(() => {
    setAnchor({
      at: Date.now(),
      duration: snapshot?.duration_ms ?? 0,
      recordingId: snapshot?.recording_id ?? '',
      status: snapshot?.status ?? 'idle',
    });
  }, [snapshot?.duration_ms, snapshot?.recording_id, snapshot?.status]);

  if (!snapshot) return 0;
  if (snapshot.status !== 'recording') return snapshot.duration_ms;
  if (anchor.recordingId !== (snapshot.recording_id ?? '') || anchor.status !== 'recording') return snapshot.duration_ms;

  return Math.max(snapshot.duration_ms, anchor.duration + now - anchor.at);
}
