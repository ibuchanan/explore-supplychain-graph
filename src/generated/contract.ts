// Generated from src/openrpc.json; do not edit.
import type { Result } from "@forge-ahead/errors";

export interface Commands {
  "workdown.export": { params: { "profile": "jira-epic"; "issue": string }; result: string };
}
export type HandlerMap<Context, Failure> = {
  [M in keyof Commands]: (params: Commands[M]["params"], context: Context) => Promise<Result<Commands[M]["result"], Failure>>;
};
export type Caller = <M extends keyof Commands>(method: M, params: Commands[M]["params"]) => Promise<Commands[M]["result"]>;
