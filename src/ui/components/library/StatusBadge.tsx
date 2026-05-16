import { clsx } from "clsx";

type DraftState = "unclassified" | "classified" | "draft_ready" | "draft_saved" | "archived";

export function StatusBadge({ state }: { state: DraftState }) {
  const label = {
    unclassified: "Pendiente",
    classified: "Clasificado",
    draft_ready: "Draft ready",
    draft_saved: "En drafts",
    archived: "Archivo",
  }[state];

  return <span className={clsx("status-badge", `is-${state}`)}>{label}</span>;
}
