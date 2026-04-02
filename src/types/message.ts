export interface ToolUse {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  status: "running" | "completed" | "failed";
}

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  toolUse: ToolUse;
}

export type ContentBlock = TextBlock | ToolUseBlock;

export interface Message {
  id: string;
  role: "user" | "assistant";
  contentBlocks: ContentBlock[];
  timestamp: number;
}

/** Concatenate all text blocks in a message into a single string. */
export function getTextContent(msg: Message): string {
  return msg.contentBlocks
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Extract all ToolUse objects from a message's content blocks. */
export function getToolUses(msg: Message): ToolUse[] {
  return msg.contentBlocks
    .filter((b): b is ToolUseBlock => b.type === "tool_use")
    .map((b) => b.toolUse);
}
