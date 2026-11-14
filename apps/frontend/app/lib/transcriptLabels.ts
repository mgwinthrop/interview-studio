// Speaker names and badge letters for the live transcript. The user is always "You"; the
// interviewer is shown by its own name, so a custom interviewer is not labelled as someone else.

type Role = "user" | "assistant";

const FALLBACK_INTERVIEWER = "Interviewer";

export function speakerLabel(role: Role, interviewerName: string): string {
  if (role === "user") return "You";
  return interviewerName.trim() || FALLBACK_INTERVIEWER;
}

export function speakerBadge(role: Role, interviewerName: string): string {
  const [first = ""] = Array.from(speakerLabel(role, interviewerName));
  return first.toUpperCase();
}
