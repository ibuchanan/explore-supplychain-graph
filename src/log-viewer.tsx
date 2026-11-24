import { invoke } from "@forge/bridge";
import {
  Button,
  CodeBlock,
  DynamicTable,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
} from "@forge/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Commands } from "./generated/contract";

type LogKind = Commands["logs.list"]["params"]["kind"];
type LogEvent = Commands["logs.list"]["result"]["events"][number];
type LogPage = Commands["logs.list"]["result"];

type LogViewerError = "forbidden" | "invalid-params" | "logs-unavailable";

export type LogViewerResponse =
  | { ok: true; page: LogPage }
  | { ok: false; error: LogViewerError };

type Query = {
  kind: LogKind;
  from: string;
  to: string;
  cursor?: string;
};

const limit = 20;
const oneHourMs = 60 * 60 * 1000;
const tabKinds: LogKind[] = ["audit", "operational"];

function newQuery(kind: LogKind): Query {
  const to = new Date();
  return {
    kind,
    from: new Date(to.getTime() - oneHourMs).toISOString(),
    to: to.toISOString(),
  };
}

function params(query: Query): Commands["logs.list"]["params"] {
  return {
    kind: query.kind,
    limit,
    from: query.from,
    to: query.to,
    ...(query.cursor ? { cursor: query.cursor } : {}),
  };
}

function compactJson(value: unknown) {
  return JSON.stringify(value);
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function errorText(error: LogViewerError) {
  if (error === "forbidden")
    return "Jira global ADMINISTER permission is required to view stored logs.";
  if (error === "invalid-params")
    return "The log query could not be used. Restart search to try a fresh one-hour window.";
  return "Stored logs are unavailable right now. Retry the request.";
}

export function LogViewer() {
  const [query, setQuery] = useState<Query>(() => newQuery("operational"));
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<LogViewerError | undefined>();
  const [emptyBatch, setEmptyBatch] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<LogEvent | undefined>();
  const requestId = useRef(0);
  const inFlightKey = useRef<string | undefined>();

  const load = useCallback(async (nextQuery: Query, append: boolean) => {
    const requestKey = JSON.stringify({ nextQuery, append });
    if (inFlightKey.current === requestKey) return;
    inFlightKey.current = requestKey;
    const id = requestId.current + 1;
    requestId.current = id;
    setQuery(nextQuery);
    setLoadingMore(append);
    if (!append) {
      setLoading(true);
      setEvents([]);
      setNextCursor(undefined);
      setSelectedEvent(undefined);
    }
    setError(undefined);
    setEmptyBatch(false);

    let response: LogViewerResponse;
    try {
      const value = await invoke<LogViewerResponse>(
        "logs.list",
        params(nextQuery),
      );
      response = "body" in value ? value.body : value;
    } catch {
      response = { ok: false, error: "logs-unavailable" };
    }
    if (requestId.current !== id) return;
    inFlightKey.current = undefined;

    if (!response.ok) {
      setQuery(nextQuery);
      setError(response.error);
      if (response.error === "forbidden") {
        setEvents([]);
        setNextCursor(undefined);
        setSelectedEvent(undefined);
      }
      if (response.error === "invalid-params") setNextCursor(undefined);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    setQuery(nextQuery);
    setEvents((current: LogEvent[]) => {
      const existing = new Set(
        append ? current.map((event: LogEvent) => event.id) : [],
      );
      const fresh = response.page.events.filter(
        (event: LogEvent) => !existing.has(event.id),
      );
      return append ? [...current, ...fresh] : fresh;
    });
    setNextCursor(response.page.nextCursor);
    setEmptyBatch(response.page.events.length === 0);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  const initialQuery = useRef(query);
  useEffect(() => {
    void load(initialQuery.current, false);
    return () => {
      requestId.current += 1;
      inFlightKey.current = undefined;
    };
  }, [load]);

  const restart = (kind = query.kind) => {
    void load(newQuery(kind), false);
  };

  const selectedTab = query.kind === "audit" ? 0 : 1;
  const rows = events.map((event: LogEvent) => ({
    key: event.id,
    cells: [
      { key: "time", content: <Text>{event.time}</Text> },
      {
        key: "event",
        content: (
          <Stack space="space.200">
            <CodeBlock
              text={compactJson(event)}
              language="json"
              showLineNumbers={false}
              shouldWrapLongLines={false}
            />
            <Button onClick={() => setSelectedEvent(event)}>
              View details
            </Button>
          </Stack>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.200">
      <Text>Inspect recent stored events to assess Workdown's logging.</Text>
      <Text>This viewer is not a complete audit or system-health report.</Text>
      <Tabs
        id="log-kind-tabs"
        selected={selectedTab}
        onChange={(index: number) => restart(tabKinds[index] ?? "operational")}
      >
        <TabList>
          <Tab>Audit</Tab>
          <Tab>Operational</Tab>
        </TabList>
        <TabPanel>
          <Text>Audit logs</Text>
        </TabPanel>
        <TabPanel>
          <Text>Operational logs</Text>
        </TabPanel>
      </Tabs>
      <Text>
        Last hour: {query.from} – {query.to}
      </Text>
      <Button isDisabled={loading || loadingMore} onClick={() => restart()}>
        Refresh
      </Button>
      {loading ? <Spinner label="Loading logs" /> : null}
      {error ? <Text>{errorText(error)}</Text> : null}
      <DynamicTable
        head={{
          cells: [
            { key: "time", content: "Time (UTC)" },
            { key: "event", content: "Event" },
          ],
        }}
        rows={rows}
        label="Stored log events"
        isLoading={loading}
        emptyView={
          !loading && !error ? (
            <Text>
              {emptyBatch && nextCursor
                ? "No events in this batch. More events can be checked."
                : "No stored events found in this one-hour window"}
            </Text>
          ) : (
            <Text>{loading ? "Loading logs" : ""}</Text>
          )
        }
      />
      {emptyBatch && events.length > 0 && !loading && !error ? (
        <Text>
          {nextCursor
            ? "No events in this batch. More events can be checked."
            : "No more events for this query."}
        </Text>
      ) : null}
      <Text>
        {events.length} {events.length === 1 ? "event" : "events"} shown. Newest
        first.
      </Text>
      {nextCursor ? (
        <Button
          isDisabled={loading || loadingMore}
          onClick={() => void load({ ...query, cursor: nextCursor }, true)}
        >
          {loadingMore ? "Loading more" : "Load more"}
        </Button>
      ) : null}
      {error === "invalid-params" ? (
        <Button onClick={() => restart()}>Restart search</Button>
      ) : null}
      {error === "logs-unavailable" ? (
        <Button onClick={() => void load(query, events.length > 0)}>
          Retry
        </Button>
      ) : null}
      <ModalTransition>
        {selectedEvent ? (
          <Modal onClose={() => setSelectedEvent(undefined)} width="large">
            <ModalHeader>
              <ModalTitle>Log event details</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <CodeBlock
                text={prettyJson(selectedEvent)}
                language="json"
                showLineNumbers
                shouldWrapLongLines
              />
            </ModalBody>
            <ModalFooter>
              <Button onClick={() => setSelectedEvent(undefined)}>Close</Button>
            </ModalFooter>
          </Modal>
        ) : null}
      </ModalTransition>
    </Stack>
  );
}
