import type { AgentSession } from "./types";

type ResumeBuilder = (value: string) => string[];

// Mirrors herdr's src/agent_resume.rs plan(): only official `herdr:<agent>`
// sources are resumable, and each agent resumes with a fixed argv shape.
const RESUME_TABLE: Readonly<Record<string, ResumeBuilder>> = {
  claude: (value) => ["claude", "--resume", value],
  codex: (value) => ["codex", "resume", value],
  copilot: (value) => ["copilot", `--resume=${value}`],
  devin: (value) => ["devin", "--resume", value],
  droid: (value) => ["droid", "--resume", value],
  kimi: (value) => ["kimi", "--session", value],
  mastracode: (value) => ["mastracode", "--thread", value],
  pi: (value) => ["pi", "--session", value],
  omp: (value) => ["omp", `--resume=${value}`],
  hermes: (value) => ["hermes", "--resume", value],
  opencode: (value) => ["opencode", "--session", value],
  qodercli: (value) => ["qodercli", "--resume", value],
  kilo: (value) => ["kilo", "--session", value],
  cursor: (value) => ["cursor-agent", "--resume", value],
  grok: (value) => ["grok", "--resume", value],
};

export const isResumableAgent = (session: AgentSession): boolean =>
  session.source === `herdr:${session.agent}` && RESUME_TABLE[session.agent] !== undefined;

export const resumeArgv = (session: AgentSession): string[] | null => {
  if (!isResumableAgent(session)) return null;

  return RESUME_TABLE[session.agent](session.value);
};
