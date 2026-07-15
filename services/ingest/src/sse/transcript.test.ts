import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSseTranscript } from "./transcript.js";

describe("parseSseTranscript", () => {
  it("parses TxLINE's data-before-id historical format", () => {
    const messages = parseSseTranscript(
      'data: {"Seq":0,"Ts":1000}\nid: 0\n\ndata: {"Seq":1,"Ts":2000}\nid: 1\n',
    );

    assert.deepEqual(messages, [
      { id: "0", event: "message", data: '{"Seq":0,"Ts":1000}' },
      { id: "1", event: "message", data: '{"Seq":1,"Ts":2000}' },
    ]);
  });

  it("handles CRLF, comments, named events, and multiline data", () => {
    const messages = parseSseTranscript(
      ": keepalive\r\nevent: update\r\nid: abc\r\ndata: first\r\ndata: second\r\n\r\n",
    );

    assert.deepEqual(messages, [
      { id: "abc", event: "update", data: "first\nsecond" },
    ]);
  });

  it("ignores text that does not contain a dispatchable SSE event", () => {
    assert.deepEqual(
      parseSseTranscript("temporary upstream error\nid: cursor\n"),
      [],
    );
  });
});
