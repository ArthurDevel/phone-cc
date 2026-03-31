export interface ToolUse {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  status: "running" | "completed" | "failed";
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolUses: ToolUse[];
  timestamp: number;
}
