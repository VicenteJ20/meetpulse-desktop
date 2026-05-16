import type { AudioRow, CloudClient, CloudJob, CloudProject } from "./audioTypes";
import {
  isDraftClient,
  recordingAudioPath,
  sanitizeRelativePathPart,
  transcriptionRelativePath,
} from "./audioLibrary";
import { allProjects, unclassifiedClient } from "./libraryConstants";

export function mergeClientGroups(localClients: { name: string; count: number }[], cloudClients: CloudClient[]) {
  const merged = new Map(localClients.map((client) => [client.name, client]));

  cloudClients.forEach((client) => {
    const name = client.display_name || client.slug;
    if (!merged.has(name)) {
      merged.set(name, { name, count: 0 });
    }
  });

  return Array.from(merged.values()).sort((left, right) => {
    if (left.name === unclassifiedClient) return -1;
    if (right.name === unclassifiedClient) return 1;
    return left.name.localeCompare(right.name);
  });
}

export function mergeProjectsForClient(
  localProjects: { name: string; count: number }[],
  cloudProjects: CloudProject[],
  cloudClients: CloudClient[],
  cloudJobs: CloudJob[],
  selectedClient: string,
) {
  const selectedCloudClient = cloudClients.find(
    (client) => client.display_name === selectedClient || client.slug === selectedClient,
  );
  const selectedClientSlug = selectedCloudClient?.slug ?? selectedClient;
  const merged = new Map(localProjects.map((project) => [project.name, project]));

  cloudProjects
    .filter((project) => project.client === selectedClientSlug)
    .forEach((project) => {
      const name = project.display_name || project.slug;
      if (!merged.has(name)) {
        merged.set(name, { name, count: 0 });
      }
    });

  return Array.from(merged.values()).map((project) => {
    const relativePath = transcriptionRelativePath(selectedClient, project.name);
    const availability = cloudAvailabilityForRelativePath(cloudJobs, relativePath);
    return { ...project, ...availability };
  });
}

export function parseCloudClients(value: unknown): CloudClient[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.slug !== "string" || typeof item.display_name !== "string") return [];
    return [
      {
        slug: item.slug,
        display_name: item.display_name,
        status: typeof item.status === "string" ? item.status : undefined,
        projects: Array.isArray(item.projects) ? item.projects.filter((project): project is string => typeof project === "string") : [],
        tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
      },
    ];
  });
}

export function parseCloudProjects(value: unknown): CloudProject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.slug !== "string" ||
      typeof item.display_name !== "string" ||
      typeof item.client !== "string"
    ) {
      return [];
    }

    return [
      {
        slug: item.slug,
        display_name: item.display_name,
        client: item.client,
        status: typeof item.status === "string" ? item.status : undefined,
      },
    ];
  });
}

export function parseCloudJobs(value: unknown): CloudJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.job_id !== "string" || typeof item.source_filename !== "string" || typeof item.status !== "string") {
      return [];
    }

    return [
      {
        job_id: item.job_id,
        source_filename: item.source_filename,
        source_size_bytes: typeof item.source_size_bytes === "number" ? item.source_size_bytes : undefined,
        source_duration_ms: typeof item.source_duration_ms === "number" || item.source_duration_ms === null ? item.source_duration_ms : undefined,
        relative_path: typeof item.relative_path === "string" ? item.relative_path : undefined,
        status: item.status,
        accepted_at: typeof item.accepted_at === "string" ? item.accepted_at : undefined,
        completed_at: typeof item.completed_at === "string" || item.completed_at === null ? item.completed_at : undefined,
        has_audio: typeof item.has_audio === "boolean" ? item.has_audio : undefined,
        audio_url: typeof item.audio_url === "string" || item.audio_url === null ? item.audio_url : undefined,
        has_transcription: typeof item.has_transcription === "boolean" ? item.has_transcription : undefined,
        has_analysis: typeof item.has_analysis === "boolean" ? item.has_analysis : undefined,
      },
    ];
  });
}

export function cloudJobToAudioRow(job: CloudJob, cloudClients: CloudClient[] = [], cloudProjects: CloudProject[] = []): AudioRow {
  const { client, project, clientSlug, projectSlug } = relativePathToLabels(job.relative_path, cloudClients, cloudProjects);
  const title = job.source_filename.replace(/\.(opus|mp3)$/i, "") || job.job_id;
  const startedAt = job.accepted_at ?? job.completed_at ?? new Date(0).toISOString();
  const hasCloudContent = Boolean(job.has_transcription || job.has_analysis);
  const status: AudioRow["status"] = job.status === "archived" ? "archived" : hasCloudContent ? "classified" : "draft_saved";

  return {
    recording: {
      id: job.job_id,
      status: job.status,
      started_at: startedAt,
      completed_at: job.completed_at,
      duration_ms: job.source_duration_ms ?? 0,
      folder_path: "",
      final_audio_path: null,
      audio_url: job.audio_url ?? null,
      source_duration_ms: job.source_duration_ms ?? null,
      segments: 0,
      size_bytes: job.source_size_bytes ?? 0,
    },
    metadata: {
      client,
      project,
      title,
      notes: "",
      draftState: status,
    },
    displayName: title,
    client,
    project,
    clientSlug,
    projectSlug,
    status,
    source: "cloud",
    cloudJobId: job.job_id,
  };
}

export function findCloudJobForRow(row: AudioRow, rows: AudioRow[], jobs: CloudJob[], linkedJobId?: string): CloudJob | undefined {
  const candidates = audioJobCandidateNames(row);
  const rowRelativePath = transcriptionRelativePath(row.client, row.project);

  if (linkedJobId) {
    const linkedJob = jobs.find((job) => job.job_id === linkedJobId);
    if (linkedJob) return linkedJob;
  }

  const byStrictMatch = jobs.find((job) => cloudJobMatchesRow(job, candidates, rowRelativePath));
  if (byStrictMatch) return byStrictMatch;

  const rowsInSamePath = rows.filter((candidate) => transcriptionRelativePath(candidate.client, candidate.project) === rowRelativePath);
  if (rowsInSamePath.length !== 1) return undefined;

  const artifactJobsInSamePath = jobs.filter(
    (job) =>
      normalizeRelativePathForMatch(job.relative_path ?? "") === normalizeRelativePathForMatch(rowRelativePath) &&
      (job.has_transcription || job.has_analysis),
  );

  if (artifactJobsInSamePath.length === 1) return artifactJobsInSamePath[0];

  return artifactJobsInSamePath.find((job) => isGenericMixedAudioName(job.source_filename));
}

export function relativePathToLabels(
  relativePath?: string,
  cloudClients: CloudClient[] = [],
  cloudProjects: CloudProject[] = [],
): { client: string; project: string; clientSlug?: string; projectSlug?: string } {
  const parts = (relativePath ?? "drafts")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  const rawClientSlug = parts[0] && !isDraftClient(parts[0]) ? sanitizeRelativePathPart(parts[0]) : undefined;
  const rawProjectSlug = parts[1] ? sanitizeRelativePathPart(parts[1]) : undefined;
  const cloudClient = rawClientSlug ? cloudClients.find((client) => client.slug === rawClientSlug) : undefined;
  const cloudProject = rawClientSlug && rawProjectSlug
    ? cloudProjects.find((project) => project.client === rawClientSlug && project.slug === rawProjectSlug)
    : undefined;

  const client = rawClientSlug ? (cloudClient?.display_name || slugToDisplay(rawClientSlug)) : unclassifiedClient;
  const project = rawProjectSlug ? (cloudProject?.display_name || slugToDisplay(rawProjectSlug)) : allProjects;
  return { client, project, clientSlug: rawClientSlug, projectSlug: rawProjectSlug };
}

function slugToDisplay(slug: string): string {
  const words = slug.replace(/[_-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || slug;
}

function audioJobCandidateNames(row: AudioRow): Set<string> {
  const path = recordingAudioPath(row.recording);
  const pathFileName = path.split(/[\\/]/).pop() ?? "";
  const displayName = row.displayName.trim();
  const names = [displayName, `${displayName}.opus`, `${displayName}.mp3`];
  if (!isGenericMixedAudioName(pathFileName)) {
    names.push(pathFileName);
  }
  return new Set(names.map(normalizeJobFileName).filter(Boolean));
}

function normalizeJobFileName(value: string): string {
  return value.trim().toLowerCase().replace(/\.(opus|mp3)$/i, "");
}

function isGenericMixedAudioName(value: string): boolean {
  const normalized = normalizeJobFileName(value);
  return normalized === "mixed" || normalized === "audio";
}

function cloudJobMatchesRow(job: CloudJob, candidates: Set<string>, rowRelativePath: string): boolean {
  if (!candidates.has(normalizeJobFileName(job.source_filename))) return false;
  if (!job.relative_path) return true;
  return normalizeRelativePathForMatch(job.relative_path) === normalizeRelativePathForMatch(rowRelativePath);
}

function cloudAvailabilityForRelativePath(jobs: CloudJob[], relativePath: string) {
  const normalizedPath = normalizeRelativePathForMatch(relativePath);
  const matches = jobs.filter((job) => normalizeRelativePathForMatch(job.relative_path ?? "") === normalizedPath);
  return {
    hasTranscription: matches.some((job) => Boolean(job.has_transcription)),
    hasAnalysis: matches.some((job) => Boolean(job.has_analysis)),
  };
}

function normalizeRelativePathForMatch(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map(sanitizeRelativePathPart)
    .filter(Boolean)
    .join("/");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
