// Shared wording for counting interviewers. The UI says "interviewer", not "persona": in this
// app a persona is one field of an interviewer (and the persona-from-calls feature), not a synonym.

export function interviewersUsedLabel(count: number): string {
  return `${count} interviewer${count === 1 ? "" : "s"} used`;
}
