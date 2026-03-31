export interface SessionMetadata {
  id: string;
  branchName: string;
  projectName: string;
  repoUrl: string;
  createdAt: string;
}

export type SessionStatus = "active" | "disconnected";

export interface Session extends SessionMetadata {
  status: SessionStatus;
}
