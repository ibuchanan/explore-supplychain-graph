import { afterEach, describe, expect, it, vi } from "vitest";
import { runAsync, runSync } from "../src/index";

describe("scaffold web triggers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const expectedResponse = {
    body: '{"hello": "world"}',
    headers: {
      "Content-Type": ["application/json"],
      "X-Request-Id": ["rnd-0.5"],
    },
    statusCode: 200,
    statusText: "OK",
  };

  it("returns a JSON response from the synchronous trigger", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(runSync()).toEqual(expectedResponse);
  });

  it("returns the same response after the asynchronous delay", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const response = runAsync();

    await vi.advanceTimersByTimeAsync(1000);

    await expect(response).resolves.toEqual(expectedResponse);
  });
});
