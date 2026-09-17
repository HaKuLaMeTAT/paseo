interface Heading {
  title: string;
  level: number;
  startLine: number;
  endLine: number;
}

// ATX headings only. Fenced examples often contain shell comments starting with #.
export function markdownSections(source: string): Heading[] {
  const lines = source.split("\n");
  const headings: Heading[] = [];
  let fence: { character: string; length: number } | undefined;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1]![0] === fence.character &&
        marker[1]!.length >= fence.length &&
        !marker[2]!.trim()
      )
        fence = undefined;
      continue;
    }
    if (marker) {
      fence = { character: marker[1]![0]!, length: marker[1]!.length };
      continue;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
    if (!heading) continue;
    headings.push({
      title: heading[2]!.replace(/[ \t]+#+[ \t]*$/, ""),
      level: heading[1]!.length,
      startLine: index + 1,
      endLine: lines.length,
    });
  }
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i]!;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j]!.level <= current.level) {
        current.endLine = headings[j]!.startLine - 1;
        break;
      }
    }
  }
  return headings;
}

export function selectMarkdown(source: string, section?: string, outline?: boolean): string {
  const headings = markdownSections(source);
  if (outline)
    return headings
      .map((h) => `${h.startLine}-${h.endLine}\t${"#".repeat(h.level)} ${h.title}`)
      .join("\n");
  const matches = headings.filter((h) => h.title === section);
  if (matches.length !== 1)
    throw new Error(
      `Expected one exact Markdown heading for section ${JSON.stringify(section)}; found ${matches.length}. Use outline=true, then select a unique heading or explicit line range.`,
    );
  const match = matches[0]!;
  return source
    .split("\n")
    .slice(match.startLine - 1, match.endLine)
    .join("\n");
}
