import { expect, it } from "vitest";
import { outputValidators } from "../src/generated/validators.js";
import { createDeployedRpc, loadDeployedScenarios } from "./deployed-harness";

it("records TWG acknowledgment for the current retained loopback update", async () => {
  if (process.env["WORKDOWN_PUBLICATION_TEST"] !== "1")
    throw new Error(
      "Use npm run test:deployed:publication to authorize an ingestion attempt for the configured Epic",
    );
  const scenario = loadDeployedScenarios().issues["epicWithStartDate"];
  if (!scenario || "errorCode" in scenario.expected)
    throw new Error(
      "Configure a successful epicWithStartDate scenario before ingestion",
    );
  const call = createDeployedRpc();
  const started = await call("exchange.start", {
    connection: "development-loopback",
    profile: "jira-epic",
    issue: scenario.key,
  });
  const start = started.result;
  if (!outputValidators["exchange.start"](start))
    throw new Error("Invalid Exchange acknowledgment; content suppressed");
  expect(start.loopback).toBe(true);
  expect(start.connection === "development-loopback").toBe(true);

  const response = await call("publication.status", {
    connection: start.connection,
    document: start.document,
  });
  const status = response.result;
  if (!outputValidators["publication.status"](status))
    throw new Error("Invalid Publication status; content suppressed");
  expect(status.loopback).toBe(true);
  expect(
    status.connection === start.connection &&
      status.document === start.document,
  ).toBe(true);
  expect(status.retainedSequence >= start.updateSequenceNumber).toBe(true);
  // Only sequences are safe to print; no document identity, bytes or credentials.
  console.info("Publication acknowledgment", {
    retainedSequence: status.retainedSequence,
    publishedSequence: status.publishedSequence,
  });
  expect(
    status.publishedSequence,
    "Current retained update must have acknowledged TWG ingestion; null is not a pass. Search visibility is a separate check.",
  ).toBe(status.retainedSequence);
}, 60_000);
