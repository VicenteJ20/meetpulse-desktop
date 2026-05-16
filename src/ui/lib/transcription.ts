import { audioFileName, transcriptionRelativePath } from "./audioLibrary";
import { isRecord } from "./cloudLibrary";

export function parseTranscriptionAccepted(body: string): { job_id?: string; status?: string } | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isRecord(parsed)) return null;
    return {
      job_id: typeof parsed.job_id === "string" ? parsed.job_id : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
    };
  } catch {
    return null;
  }
}

export async function requestBrowserTranscription({
  endpoint,
  apiKey,
  audioSrc,
  audioPath,
  displayName,
  client,
  project,
  durationMs,
}: {
  endpoint: string;
  apiKey: string;
  audioSrc: string;
  audioPath: string;
  displayName: string;
  client: string;
  project: string;
  durationMs?: number;
}): Promise<{ status: number; body: string }> {
  const audioResponse = await fetch(audioSrc);
  if (!audioResponse.ok) {
    throw new Error("No se pudo leer el archivo de audio local.");
  }

  const blob = await audioResponse.blob();
  const fileName = audioFileName(audioPath, displayName);
  const form = new FormData();
  form.append("file", blob, fileName);
  form.append("relative_path", transcriptionRelativePath(client, project));
  if (durationMs && durationMs > 0) {
    form.append("duration_ms", String(Math.round(durationMs)));
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
    body: form,
  });

  const body = await response.text();

  if (response.status !== 202) {
    throw new Error(responseErrorText(response.status, body));
  }

  return { status: response.status, body };
}

export async function responseErrorMessage(response: Response): Promise<string> {
  const fallback = `El servicio respondio ${response.status}.`;
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
    if (typeof payload?.message === "string") return payload.message;
    return fallback;
  } catch {
    const text = await response.text().catch(() => "");
    return text.trim() || fallback;
  }
}

function responseErrorText(status: number, body: string): string {
  const fallback = `El servicio respondio ${status}.`;
  if (!body.trim()) return fallback;
  try {
    const payload = JSON.parse(body) as unknown;
    if (isRecord(payload) && typeof payload.detail === "string") return payload.detail;
    if (isRecord(payload) && typeof payload.message === "string") return payload.message;
    return fallback;
  } catch {
    return body.trim() || fallback;
  }
}
