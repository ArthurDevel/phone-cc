export function renderMarkdown(text: string): string {
  if (!text) return "";

  // Escape HTML
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (``` ... ```)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, _lang, code) =>
      `<pre class="bg-background rounded-lg p-3 my-2 overflow-x-auto"><code class="font-mono text-xs">${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="bg-background px-1.5 py-0.5 rounded text-xs font-mono">$1</code>'
  );

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  // Process lines for lists and line breaks
  const lines = html.split("\n");
  const result: string[] = [];
  let inUl = false;
  let inOl = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Bullet list
    if (/^[-*] /.test(trimmed)) {
      if (!inUl) {
        if (inOl) { result.push("</ol>"); inOl = false; }
        result.push('<ul class="list-disc list-inside my-1">');
        inUl = true;
      }
      result.push(`<li>${trimmed.slice(2)}</li>`);
      continue;
    }

    // Numbered list
    if (/^\d+\. /.test(trimmed)) {
      if (!inOl) {
        if (inUl) { result.push("</ul>"); inUl = false; }
        result.push('<ol class="list-decimal list-inside my-1">');
        inOl = true;
      }
      result.push(`<li>${trimmed.replace(/^\d+\. /, "")}</li>`);
      continue;
    }

    // Close any open lists
    if (inUl) { result.push("</ul>"); inUl = false; }
    if (inOl) { result.push("</ol>"); inOl = false; }

    // Skip empty lines inside pre blocks (already handled)
    if (trimmed.startsWith("<pre")) {
      result.push(line);
      continue;
    }

    if (trimmed === "") {
      result.push("<br>");
    } else {
      result.push(line);
    }
  }

  if (inUl) result.push("</ul>");
  if (inOl) result.push("</ol>");

  return result.join("\n");
}
