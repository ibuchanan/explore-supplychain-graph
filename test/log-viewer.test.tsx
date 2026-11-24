/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Cell = { key: string; content: ReactNode };
const invoke = vi.fn();

vi.mock("@forge/bridge", () => ({ invoke }));

vi.mock("@forge/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  const DynamicTable = ({
    head,
    rows = [],
    label,
    isLoading,
    emptyView,
  }: {
    head?: { cells: Cell[] };
    rows?: { key: string; cells: Cell[] }[];
    label?: string;
    isLoading?: boolean;
    emptyView?: ReactNode;
  }) => (
    <div aria-busy={isLoading ? "true" : "false"}>
      <table aria-label={label}>
        <thead>
          <tr>
            {head?.cells?.map((cell: any) => (
              <th key={cell.key}>{cell.content}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: { key: string; cells: Cell[] }) => (
            <tr key={row.key}>
              {row.cells.map((cell: any, index: number) => (
                <td key={cell.key ?? index}>{cell.content}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && emptyView}
    </div>
  );
  const CodeBlock = ({ text }: { text: string }) => <pre>{text}</pre>;
  const Stack = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Text = ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  );
  const Button = ({ children, onClick, isDisabled }: any) => (
    <button disabled={isDisabled} onClick={onClick} type="button">
      {children}
    </button>
  );
  const Spinner = ({ label }: { label?: string }) => (
    <div role="status">{label}</div>
  );
  const Tabs = ({ children, selected, onChange }: any) => (
    <div data-selected-tab={selected}>
      {React.Children.map(children, (child: React.ReactNode) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, { onChange })
          : child,
      )}
    </div>
  );
  const TabList = ({ children, onChange }: any) => (
    <div role="tablist">
      {React.Children.map(children, (child: React.ReactNode, index: number) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, {
              index,
              onChange,
            })
          : child,
      )}
    </div>
  );
  const Tab = ({ children, index, onChange }: any) => (
    <button onClick={() => onChange?.(index)} role="tab" type="button">
      {children}
    </button>
  );
  const TabPanel = ({ children }: { children: React.ReactNode }) => (
    <div role="tabpanel">{children}</div>
  );
  const ModalTransition = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  const Modal = ({ children, onClose }: any) => (
    <div aria-modal="true" role="dialog">
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, { onClose })
          : child,
      )}
    </div>
  );
  const ModalHeader = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const ModalTitle = ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  );
  const ModalBody = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const ModalFooter = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );

  return {
    DynamicTable,
    CodeBlock,
    Stack,
    Text,
    Button,
    Spinner,
    Tabs,
    TabList,
    Tab,
    TabPanel,
    ModalTransition,
    Modal,
    ModalHeader,
    ModalTitle,
    ModalBody,
    ModalFooter,
  };
});

const operationalEvent = {
  specversion: "1.0" as const,
  id: "op-1",
  source: "urn:workdown:operational" as const,
  type: "com.workdown.log.info" as const,
  time: "2026-11-23T16:30:00.000Z",
  data: {
    installationId: "ari:cloud:jira::site/123",
    environment: "development",
    correlationId: "corr-1",
    level: "info" as const,
    event: "workdown.publication" as const,
    stage: "ingestion" as const,
    outcome: "recorded" as const,
  },
};

describe("LogViewer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-23T16:45:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("loads the fixed last-hour Operational page on open", async () => {
    invoke.mockResolvedValue({
      ok: true,
      page: {
        kind: "operational",
        events: [operationalEvent],
        order: "newest-first",
      },
    });
    const { LogViewer } = await import("../src/log-viewer");

    render(<LogViewer />);

    expect(screen.getByRole("status").textContent).toBe("Loading logs");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("logs.list", {
        kind: "operational",
        limit: 20,
        from: "2026-11-23T15:45:00.000Z",
        to: "2026-11-23T16:45:00.000Z",
      }),
    );
    expect(await screen.findByText("2026-11-23T16:30:00.000Z")).toBeTruthy();
    expect(screen.getByText(JSON.stringify(operationalEvent))).toBeTruthy();
    expect(screen.getByText("1 event shown. Newest first.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

    const table = screen.getByRole("table", { name: "Stored log events" });
    expect(
      within(table).getByRole("columnheader", { name: "Time (UTC)" }),
    ).toBeTruthy();
    expect(
      within(table).getByRole("columnheader", { name: "Event" }),
    ).toBeTruthy();
    expect(
      within(table).queryByRole("columnheader", { name: "Result" }),
    ).toBeNull();
  });

  it("distinguishes an empty candidate batch from an exhausted window and refreshes explicitly", async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        page: {
          kind: "operational",
          events: [],
          order: "newest-first",
          nextCursor: "sparse",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        page: { kind: "operational", events: [], order: "newest-first" },
      })
      .mockResolvedValueOnce({
        ok: true,
        page: { kind: "operational", events: [], order: "newest-first" },
      });
    const { LogViewer } = await import("../src/log-viewer");
    render(<LogViewer />);
    await screen.findByText(
      "No events in this batch. More events can be checked.",
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("No stored events found in this one-hour window");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    vi.setSystemTime(new Date("2026-11-23T17:00:00.000Z"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    expect(invoke).toHaveBeenLastCalledWith("logs.list", {
      kind: "operational",
      limit: 20,
      from: "2026-11-23T16:00:00.000Z",
      to: "2026-11-23T17:00:00.000Z",
    });
  });

  it("reports a sparse continuation even when earlier events remain visible", async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        page: {
          kind: "operational",
          events: [operationalEvent],
          order: "newest-first",
          nextCursor: "a",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        page: {
          kind: "operational",
          events: [],
          order: "newest-first",
          nextCursor: "b",
        },
      });
    const { LogViewer } = await import("../src/log-viewer");
    render(<LogViewer />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByText(
      "No events in this batch. More events can be checked.",
    );
    expect(screen.getByText(operationalEvent.time)).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("opens formatted JSON details without another command", async () => {
    invoke.mockResolvedValue({
      ok: true,
      page: {
        kind: "operational",
        events: [operationalEvent],
        order: "newest-first",
      },
    });
    const { LogViewer } = await import("../src/log-viewer");

    render(<LogViewer />);
    await screen.findByText("2026-11-23T16:30:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "View details" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText(JSON.stringify(operationalEvent, null, 2), {
        normalizer: (text) => text,
      }),
    ).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("changes to Audit with a fresh fixed window and clears old rows", async () => {
    const auditEvent = {
      ...operationalEvent,
      id: "audit-1",
      source: "urn:workdown:audit" as const,
      type: "com.forge-ahead.rpc.outcome" as const,
      time: "2026-11-23T16:50:00.000Z",
      data: {
        installationId: "ari:cloud:jira::site/123",
        environment: "development",
        correlationId: "corr-2",
        reason: "succeeded" as const,
        method: "logs.list" as const,
      },
    };
    invoke
      .mockResolvedValueOnce({
        ok: true,
        page: {
          kind: "operational",
          events: [operationalEvent],
          order: "newest-first",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        page: { kind: "audit", events: [auditEvent], order: "newest-first" },
      });
    const { LogViewer } = await import("../src/log-viewer");

    render(<LogViewer />);
    await screen.findByText("2026-11-23T16:30:00.000Z");
    vi.setSystemTime(new Date("2026-11-23T17:00:00.000Z"));
    fireEvent.click(screen.getByRole("tab", { name: "Audit" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("logs.list", {
        kind: "audit",
        limit: 20,
        from: "2026-11-23T16:00:00.000Z",
        to: "2026-11-23T17:00:00.000Z",
      }),
    );
    expect(await screen.findByText("2026-11-23T16:50:00.000Z")).toBeTruthy();
    expect(screen.queryByText("2026-11-23T16:30:00.000Z")).toBeNull();
  });

  it("loads one continuation batch per click and deduplicates repeated ids", async () => {
    const repeated = { ...operationalEvent };
    const second = {
      ...operationalEvent,
      id: "op-2",
      time: "2026-11-23T16:20:00.000Z",
    };
    invoke
      .mockResolvedValueOnce({
        ok: true,
        page: {
          kind: "operational",
          events: [operationalEvent],
          nextCursor: "cursor-1",
          order: "newest-first",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        page: {
          kind: "operational",
          events: [repeated, second],
          order: "newest-first",
        },
      });
    const { LogViewer } = await import("../src/log-viewer");

    render(<LogViewer />);
    await screen.findByText("2026-11-23T16:30:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenLastCalledWith("logs.list", {
      kind: "operational",
      limit: 20,
      from: "2026-11-23T15:45:00.000Z",
      to: "2026-11-23T16:45:00.000Z",
      cursor: "cursor-1",
    });
    expect(await screen.findByText("2026-11-23T16:20:00.000Z")).toBeTruthy();
    expect(screen.getByText("2 events shown. Newest first.")).toBeTruthy();
  });

  it("restarts the search after an invalid continuation", async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        page: {
          kind: "operational",
          events: [operationalEvent],
          nextCursor: "cursor-1",
          order: "newest-first",
        },
      })
      .mockResolvedValueOnce({ ok: false, error: "invalid-params" })
      .mockResolvedValueOnce({
        ok: true,
        page: { kind: "operational", events: [], order: "newest-first" },
      });
    const { LogViewer } = await import("../src/log-viewer");

    render(<LogViewer />);
    await screen.findByText("2026-11-23T16:30:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(
      await screen.findByText(
        "The log query could not be used. Restart search to try a fresh one-hour window.",
      ),
    ).toBeTruthy();

    vi.setSystemTime(new Date("2026-11-23T17:10:00.000Z"));
    fireEvent.click(screen.getByRole("button", { name: "Restart search" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("logs.list", {
        kind: "operational",
        limit: 20,
        from: "2026-11-23T16:10:00.000Z",
        to: "2026-11-23T17:10:00.000Z",
      }),
    );
  });

  it("ignores superseded responses after a kind change", async () => {
    let resolveOperational: (value: unknown) => void = () => undefined;
    invoke
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOperational = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        page: { kind: "audit", events: [], order: "newest-first" },
      });
    const { LogViewer } = await import("../src/log-viewer");

    render(<LogViewer />);
    fireEvent.click(screen.getByRole("tab", { name: "Audit" }));
    resolveOperational({
      ok: true,
      page: {
        kind: "operational",
        events: [operationalEvent],
        order: "newest-first",
      },
    });

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("2026-11-23T16:30:00.000Z")).toBeNull(),
    );
  });

  it("keeps rows on continuation unavailability but clears them on forbidden", async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        page: {
          kind: "operational",
          events: [operationalEvent],
          nextCursor: "cursor-1",
          order: "newest-first",
        },
      })
      .mockResolvedValueOnce({ ok: false, error: "logs-unavailable" })
      .mockResolvedValueOnce({ ok: false, error: "forbidden" });
    const { LogViewer } = await import("../src/log-viewer");

    render(<LogViewer />);
    await screen.findByText("2026-11-23T16:30:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(
      await screen.findByText(
        "Stored logs are unavailable right now. Retry the request.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("2026-11-23T16:30:00.000Z")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText(
        "Jira global ADMINISTER permission is required to view stored logs.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("2026-11-23T16:30:00.000Z")).toBeNull();
  });
});
