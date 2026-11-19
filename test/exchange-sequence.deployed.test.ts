import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createDeployedRpc, loadDeployedScenarios } from "./deployed-harness";

it("allocates one next sequence for concurrent changed-content starts on a disposable Epic", async () => {
  if (process.env["WORKDOWN_SEQUENCE_TEST"] !== "1")
    throw new Error(
      "Set WORKDOWN_SEQUENCE_TEST=1 to authorize disposable Jira Epic creation and edits",
    );
  const scenarios = loadDeployedScenarios();
  const sample = Object.values(scenarios.issues).find(
    (issue) =>
      issue.projectType === "company-managed" &&
      !("errorCode" in issue.expected),
  );
  if (!sample)
    throw new Error("Configure a successful company-managed Epic scenario");
  const env = process.env;
  const site = env["FORGE_SITE"];
  if (!site || !/^[a-z0-9-]+\.atlassian\.net$/.test(site))
    throw new Error("Require FORGE_SITE hostname");
  const tenantResponse = await fetch(`https://${site}/_edge/tenant_info`, {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!tenantResponse.ok)
    throw new Error(`Tenant lookup HTTP ${tenantResponse.status}`);
  const tenant = (await tenantResponse.json()) as { cloudId: string };
  if (!/^[a-f0-9-]{36}$/i.test(tenant.cloudId))
    throw new Error("Invalid tenant binding");
  const authorization = `Basic ${Buffer.from(`${env["WORKDOWN_TEST_EMAIL"]}:${env["WORKDOWN_TEST_API_TOKEN"]}`).toString("base64")}`;
  async function jira<T = undefined>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${tenant.cloudId}/rest/api/3/${path}`,
      {
        method,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Disposable fixture Jira ${method} HTTP ${response.status}; content suppressed`,
      );
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
  const source = await jira<{
    fields: { project: { id: string }; issuetype: { id: string } };
  }>(`issue/${sample.key}?fields=project,issuetype`);
  const original = "Disposable sequence baseline";
  const changed = "Disposable sequence changed";
  const adf = (text: string) => ({
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const created = await jira<{ key: string }>("issue", "POST", {
    fields: {
      project: { id: source.fields.project.id },
      issuetype: { id: source.fields.issuetype.id },
      summary: "Disposable Workdown sequence verification",
      description: adf(original),
    },
  });
  // Keep the identity locally for inspection/recovery, never in committed output.
  writeFileSync(
    new URL("./exchange-sequence.local.json", import.meta.url),
    JSON.stringify({ key: created.key, restoration: "pending" }, null, 2),
  );
  const call = createDeployedRpc();
  type Ack = {
    connection: string;
    loopback: boolean;
    document: string;
    updateSequenceNumber: number;
  };
  const params = {
    connection: "development-loopback",
    profile: "jira-epic",
    issue: created.key,
  };
  async function start() {
    const response = await call("exchange.start", params);
    expect(response.status).toBe(200);
    return response.result as Ack;
  }
  async function retained(ack: Ack, text: string, sequence: number) {
    const response = await call("document.get", {
      connection: params.connection,
      document: ack.document,
    });
    expect(response.status).toBe(200);
    const value = response.result as Ack & { workdown: string };
    expect(value.document === ack.document && value.loopback === true).toBe(
      true,
    );
    expect(value.updateSequenceNumber).toBe(sequence);
    expect(value.workdown.includes(`## Description\n\n${text}\n`)).toBe(true);
  }
  let restored = false;
  try {
    const baseline = await start();
    expect(baseline.updateSequenceNumber).toBe(1);
    await retained(baseline, original, 1);
    await jira(`issue/${created.key}`, "PUT", {
      fields: { description: adf(changed) },
    });
    const updated = await jira<{ fields: { description: unknown } }>(
      `issue/${created.key}?fields=description`,
    );
    expect(
      JSON.stringify(updated.fields.description) ===
        JSON.stringify(adf(changed)),
    ).toBe(true);
    const attempts = await Promise.all([start(), start()]);
    for (const ack of attempts) {
      expect(ack.document === baseline.document).toBe(true);
      expect(ack.updateSequenceNumber).toBe(2);
    }
    await retained(baseline, changed, 2);
    expect((await start()).updateSequenceNumber).toBe(2);
    await jira(`issue/${created.key}`, "PUT", {
      fields: { description: adf(original) },
    });
    const restoredSource = await jira<{ fields: { description: unknown } }>(
      `issue/${created.key}?fields=description`,
    );
    expect(
      JSON.stringify(restoredSource.fields.description) ===
        JSON.stringify(adf(original)),
    ).toBe(true);
    const finalAttempts = await Promise.all([start(), start()]);
    for (const ack of finalAttempts) {
      expect(ack.document === baseline.document).toBe(true);
      expect(ack.updateSequenceNumber).toBe(3);
    }
    await retained(baseline, original, 3);
    restored = true;
    expect((await start()).updateSequenceNumber).toBe(3);
    writeFileSync(
      new URL("./exchange-sequence.local.json", import.meta.url),
      JSON.stringify(
        { key: created.key, restoration: "verified", sequences: [1, 2, 3] },
        null,
        2,
      ),
    );
  } finally {
    if (!restored) {
      await jira(`issue/${created.key}`, "PUT", {
        fields: { description: adf(original) },
      });
      const ack = await start();
      await retained(ack, original, ack.updateSequenceNumber);
    }
  }
}, 180_000);
