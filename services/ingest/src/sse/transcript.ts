import type { SseMessage } from "./reader.js";

/**
 * Parse a complete text/event-stream response that has already been buffered.
 *
 * TxLINE's historical endpoint currently returns an SSE transcript even though
 * it is fetched as a one-shot response. Keeping this parser separate from the
 * live, incremental reader lets backfill preserve the same message envelope
 * shape as the recorder without pretending the response is JSON.
 */
export function parseSseTranscript(raw: string): SseMessage[] {
  const messages: SseMessage[] = [];
  let dataLines: string[] = [];
  let event = "message";
  let id: string | null = null;

  const dispatch = () => {
    if (dataLines.length > 0 || event !== "message") {
      messages.push({ id, event, data: dataLines.join("\n") });
    }
    dataLines = [];
    event = "message";
    id = null;
  };

  // The extra empty sentinel flushes a final event when the response does not
  // end with the SSE blank-line delimiter.
  const lines = raw.split("\n");
  for (let index = 0; index <= lines.length; index++) {
    let line = index === lines.length ? "" : lines[index]!;
    if (index === 0 && line.startsWith("\uFEFF")) line = line.slice(1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "") {
      dispatch();
      continue;
    }
    if (line.startsWith(":")) continue;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") dataLines.push(value);
    else if (field === "event") event = value || "message";
    else if (field === "id" && !value.includes("\0")) id = value;
    // `retry` and unknown extension fields do not affect a buffered replay.
  }

  return messages;
}
