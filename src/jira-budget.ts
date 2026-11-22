import { AsyncLocalStorage } from "node:async_hooks";

const invocation = new AsyncLocalStorage<{
  requests: number;
  deadline: number;
}>();

export function withJiraBudget<T>(work: () => T, durationMs = 35_000): T {
  return invocation.getStore()
    ? work()
    : invocation.run(
        { requests: 0, deadline: performance.now() + durationMs },
        work,
      );
}

export function checkJiraDeadline() {
  const remaining =
    (invocation.getStore()?.deadline ?? Infinity) - performance.now();
  if (remaining <= 0) throw new Error("Jira deadline exhausted");
  return remaining;
}

export function countJiraRequest() {
  checkJiraDeadline();
  const budget = invocation.getStore();
  if (budget && budget.requests++ >= 60)
    throw new Error("Jira request budget exhausted");
}
