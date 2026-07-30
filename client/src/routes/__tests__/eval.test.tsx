/**
 * The eval harness page.
 *
 * Important context for anyone reading these tests: this page fetches nothing. Every number
 * on it — the run history, the field-level accuracy, the pipeline comparison — is a hardcoded
 * constant in the source, and the "Run benchmark" button has no handler. It is a mock-up of a
 * dev tool, not a view of real data.
 *
 * So these tests pin presentation only, and deliberately assert the values come from the
 * module's own constants rather than pretending they are results. The page now says as much
 * on its face: the dead "Run benchmark" button is gone and a banner marks the figures as a
 * recorded sample from a pipeline the app no longer uses.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <div>
      <div data-testid="actions">{actions}</div>
      {children}
    </div>
  ),
  Card: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
  Metric: ({
    label,
    value,
    hint,
    delta,
  }: {
    label: string;
    value: string | number;
    hint?: string;
    delta?: { value: string };
  }) => (
    <div data-testid={`metric-${label}`}>
      <span data-testid="value">{value}</span>
      <span data-testid="hint">{hint}</span>
      <span data-testid="delta">{delta?.value}</span>
    </div>
  ),
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

// recharts measures its container, which has no layout in jsdom and renders nothing. Stubbed
// so the chart's presence is observable without pulling in a real SVG renderer.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  BarChart: ({ data, children }: { data: unknown[]; children: ReactNode }) => (
    <div data-testid="bar-chart" data-points={data.length}>
      {children}
    </div>
  ),
  Bar: () => <div data-testid="bar" />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  XAxis: ({ dataKey }: { dataKey: string }) => <div data-testid="x-axis" data-key={dataKey} />,
  YAxis: ({ domain }: { domain: number[] }) => (
    <div data-testid="y-axis" data-domain={domain?.join("-")} />
  ),
}));

import { Route } from "@/routes/eval";

const EvalPage = (Route as unknown as { component: () => ReactNode }).component;

function metric(label: string) {
  const el = screen.getByTestId(`metric-${label}`);
  return {
    value: within(el).getByTestId("value").textContent,
    hint: within(el).getByTestId("hint").textContent,
    delta: within(el).getByTestId("delta").textContent,
  };
}

describe("the route definition", () => {
  it("sets a title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Eval harness — ScoreCheck" });
  });
});

describe("the summary metrics", () => {
  it("summarises the most recent run", () => {
    render(<EvalPage />);

    // runs[0] is the newest entry in the hardcoded list.
    expect(metric("Latest accuracy").value).toBe("99.1%");
    expect(metric("Pipeline")).toMatchObject({ value: "GCV", hint: "64 images" });
    expect(metric("Avg latency")).toMatchObject({ value: "12.1s", hint: "per image" });
  });

  it("formats cost to four decimals, since it is fractions of a cent", () => {
    render(<EvalPage />);

    expect(metric("Cost / image").value).toBe("$0.0060");
  });

  it("shows a hardcoded delta rather than a computed one", () => {
    render(<EvalPage />);

    // "+0.5 vs prev" is a literal in the source, not derived from runs[1]. Pinned so the
    // discrepancy is visible if the run list ever changes.
    expect(metric("Latest accuracy").delta).toBe("+0.5 vs prev");
  });
});

describe("the field-accuracy chart", () => {
  it("plots one bar per stat field", () => {
    render(<EvalPage />);

    expect(screen.getByTestId("bar-chart")).toHaveAttribute("data-points", "8");
  });

  it("keys the axis on the field name", () => {
    render(<EvalPage />);

    expect(screen.getByTestId("x-axis")).toHaveAttribute("data-key", "field");
  });

  it("zooms the y-axis to the 90-100 band where the differences live", () => {
    render(<EvalPage />);

    // A 0-100 axis would render eight near-identical full-height bars.
    expect(screen.getByTestId("y-axis")).toHaveAttribute("data-domain", "90-100");
  });
});

describe("the pipeline comparison", () => {
  it("compares the two pipelines on every axis that matters", () => {
    render(<EvalPage />);
    const card = within(screen.getByRole("region", { name: "Pipeline comparison" }));

    for (const label of ["Accuracy", "Avg latency", "Cost / image", "Internet"]) {
      expect(card.getByText(label)).toBeInTheDocument();
    }
  });

  it("records that the local pipeline needs no internet", () => {
    render(<EvalPage />);
    const card = within(screen.getByRole("region", { name: "Pipeline comparison" }));

    // The trade the whole comparison exists to show: accuracy for cost and independence.
    expect(card.getByText("Required")).toBeInTheDocument();
    expect(card.getByText("None")).toBeInTheDocument();
  });
});

describe("the run history", () => {
  it("lists five runs, newest first", () => {
    render(<EvalPage />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);

    expect(rows).toHaveLength(5);
    expect(rows[0].querySelectorAll("td")[0].textContent).toBe("r014");
    expect(rows[4].querySelectorAll("td")[0].textContent).toBe("r010");
  });

  it("shows each run's accuracy, latency and cost", () => {
    render(<EvalPage />);
    const row = within(screen.getByRole("table")).getByText("r013").closest("tr") as HTMLElement;

    expect(within(row).getByText("96.8%")).toBeInTheDocument();
    expect(within(row).getByText("19.6s")).toBeInTheDocument();
    expect(within(row).getByText("$0.0000")).toBeInTheDocument();
  });

  it("labels every column", () => {
    render(<EvalPage />);
    const table = within(screen.getByRole("table"));

    for (const header of ["Run", "Date", "Pipeline", "Images", "Accuracy", "Latency", "Cost"]) {
      expect(table.getByText(header)).toBeInTheDocument();
    }
  });
});

describe("honesty about the data", () => {
  it("marks the figures as an illustrative sample", () => {
    render(<EvalPage />);

    expect(screen.getByText("Illustrative sample")).toBeInTheDocument();
    expect(screen.getByText(/are a recorded sample from an earlier/)).toBeInTheDocument();
  });

  it("says the app no longer uses the pipelines being compared", () => {
    render(<EvalPage />);

    // The table names GCV and Qwen2.5-VL; extraction now runs a fine-tuned model on Modal,
    // so a reader has to be told the comparison is historical.
    expect(screen.getByText(/fine-tuned model/)).toBeInTheDocument();
  });

  it("points at the command that produces current numbers", () => {
    render(<EvalPage />);

    expect(screen.getByText("npm run eval")).toBeInTheDocument();
  });

  it("offers no action it cannot perform", () => {
    render(<EvalPage />);

    // The old "Run benchmark" button had no handler at all — a control that looks like it
    // starts a benchmark and silently does nothing is worse than no control.
    expect(screen.queryByRole("button", { name: "Run benchmark" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
