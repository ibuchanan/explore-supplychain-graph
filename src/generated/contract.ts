// Generated from src/openrpc.json; do not edit.
import type { Result } from "@forge-ahead/errors";
export interface Commands {
"workdown.export": { params: { "profile": "jira-epic"; "issue": string }; result: string };
"exchange.start": { params: { "connection": string; "profile": "jira-epic"; "issue": string }; result: { "connection": string; "loopback": boolean; "document": string; "updateSequenceNumber": number } };
"document.get": { params: { "connection": string; "document": string }; result: { "connection": string; "loopback": boolean; "document": string; "updateSequenceNumber": number; "workdown": string } };
"publication.status": { params: { "connection": string; "document": string }; result: { "connection": string; "loopback": boolean; "document": string; "retainedSequence": number; "publishedSequence": number | null } };
}
export type HandlerMap<Context, Failure> = { [M in keyof Commands]: (params: Commands[M]["params"], context: Context) => Promise<Result<Commands[M]["result"], Failure>> };
export type Caller = <M extends keyof Commands>(method: M, params: Commands[M]["params"]) => Promise<Commands[M]["result"]>;
