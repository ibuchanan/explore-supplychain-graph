export type Installation = { cloudId: string; apiBase: string };
export type Principal = { accountId: string; authorization: string };
export type CommandContext = {
  installation: Installation;
  principal: Principal;
};

export function installation(context: {
  installContext?: string;
}): Installation | undefined {
  const match =
    /^ari:cloud:jira::site\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      context.installContext ?? "",
    );
  const cloudId = match?.[1];
  return cloudId
    ? { cloudId, apiBase: `https://api.atlassian.com/ex/jira/${cloudId}` }
    : undefined;
}

export const jiraGet = (
  installation: Installation,
  authorization: string,
  path: string,
) =>
  fetch(`${installation.apiBase}/rest/api/3/${path}`, {
    headers: { Authorization: authorization, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });

export async function authenticate(
  authorization: string,
  installation: Installation,
): Promise<
  | { kind: "authenticated"; principal: Principal }
  | { kind: "unauthorized" | "forbidden" | "unavailable" }
> {
  if (!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization))
    return { kind: "unauthorized" as const };
  const response = await jiraGet(installation, authorization, "myself");
  if (response.status === 401) return { kind: "unauthorized" as const };
  if (response.status === 403) return { kind: "forbidden" as const };
  if (!response.ok) return { kind: "unavailable" as const };
  const user = (await response.json()) as {
    accountId?: unknown;
    active?: unknown;
    accountType?: unknown;
  };
  if (
    typeof user.accountId !== "string" ||
    !user.accountId ||
    user.active !== true ||
    user.accountType !== "atlassian"
  )
    return { kind: "forbidden" as const };
  return {
    kind: "authenticated" as const,
    principal: { accountId: user.accountId as string, authorization },
  };
}

export async function authenticateAdmin(
  authorization: string,
  installation: Installation,
) {
  const identity = await authenticate(authorization, installation);
  if (identity.kind !== "authenticated") return identity;
  const permissions = await jiraGet(
    installation,
    authorization,
    "mypermissions?permissions=ADMINISTER",
  );
  if (!permissions.ok) return { kind: "unavailable" as const };
  const data = (await permissions.json()) as {
    permissions?: { ADMINISTER?: { havePermission?: unknown } };
  };
  if (data.permissions?.ADMINISTER?.havePermission !== true)
    return { kind: "forbidden" as const };
  return identity;
}

export async function isProjectAdmin(
  issue: string,
  context: CommandContext,
): Promise<boolean> {
  if (!issue.trim()) return false;
  try {
    const response = await jiraGet(
      context.installation,
      context.principal.authorization,
      `mypermissions?permissions=ADMINISTER_PROJECTS&${/^\d+$/.test(issue) ? "issueId" : "issueKey"}=${encodeURIComponent(issue)}`,
    );
    if (!response.ok) return false;
    const data = (await response.json()) as {
      permissions?: { ADMINISTER_PROJECTS?: { havePermission?: unknown } };
    };
    return data.permissions?.ADMINISTER_PROJECTS?.havePermission === true;
  } catch {
    return false;
  }
}
