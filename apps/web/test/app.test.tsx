// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App.js";

const MINT = "11111111111111111111111111111111";
const report = {
  schemaVersion: "1.0",
  engineVersion: "0.1.0",
  generatedAt: "2026-08-19T00:00:00.000Z",
  cluster: "devnet",
  input: { mint: MINT },
  tokenProgram: "token-2022",
  mint: {
    address: MINT,
    decimals: 6,
    supplyRaw: "1",
    mintAuthority: null,
    freezeAuthority: null,
    extensions: ["PermanentDelegate"],
  },
  overallStatus: "WARNING",
  findings: [
    {
      id: "permanent-delegate",
      status: "WARNING",
      category: "authority",
      title: "Permanent delegate is active",
      summary: "The delegate can transfer or burn tokens.",
      requiredActions: [],
      evidence: [
        {
          account: MINT,
          accountKind: "mint",
          field: "extensions.PermanentDelegate.delegate",
          value: MINT,
        },
      ],
    },
  ],
  limitations: ["No transaction simulation is performed."],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("confirms when the CLI command has been copied", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Copy CLI command" }));

    expect(await screen.findByRole("button", { name: "Copied" })).toBeVisible();
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("keeps the header focused on product information", () => {
    render(<App />);

    expect(screen.getByText("Token-2022 Preflight")).toBeVisible();
    expect(screen.queryByText("engine 0.1.0")).not.toBeInTheDocument();
    expect(screen.queryByText("no signing")).not.toBeInTheDocument();
    expect(screen.queryByText(/RPC READY/)).not.toBeInTheDocument();
  });

  it("reveals token-account fields in Transfer mode", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    expect(screen.getByLabelText("Source token account")).toBeVisible();
    expect(screen.getByLabelText("Destination token account")).toBeVisible();
  });

  it("submits a basic analysis and renders findings, evidence, JSON and CLI command", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(report), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.change(screen.getByLabelText("Mint address"), {
      target: { value: MINT },
    });
    fireEvent.change(screen.getByLabelText("Cluster"), {
      target: { value: "devnet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));

    await screen.findByText("Permanent delegate is active");
    fireEvent.click(screen.getByText("Evidence"));
    expect(
      screen.getByText("extensions.PermanentDelegate.delegate"),
    ).toBeVisible();
    expect(screen.getByText(/token22 inspect/)).toHaveTextContent(
      `token22 inspect ${MINT} --cluster devnet`,
    );
    expect(screen.getByText(/"schemaVersion": "1.0"/)).toBeVisible();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/v1/preflight",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows required actions only for findings that provide them", async () => {
    const value = {
      ...report,
      findings: [
        {
          ...report.findings[0],
          requiredActions: ["Use official conversion helpers."],
        },
        {
          ...report.findings[0],
          id: "informational-metadata",
          title: "Metadata detected",
          requiredActions: [],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText("Mint address"), {
      target: { value: MINT },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));

    expect(
      await screen.findByText("Use official conversion helpers."),
    ).toBeVisible();
    expect(screen.getAllByText("Required actions")).toHaveLength(1);
  });

  it("shows an accessible error when the API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText("Mint address"), {
      target: { value: MINT },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "RPC service is unavailable",
    );
  });

  it("shows the API message for an invalid amount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "INVALID_AMOUNT",
              message: "Amount has more than 6 decimal places",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText("Mint address"), {
      target: { value: MINT },
    });
    fireEvent.change(screen.getByLabelText("Amount (UI units)"), {
      target: { value: "1.0000001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Amount has more than 6 decimal places",
    );
  });

  it("labels UI and raw transfer amounts", async () => {
    const value = {
      ...report,
      input: { mint: MINT, amountUi: "1.5" },
      transfer: { amountRaw: "1500000" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText("Mint address"), {
      target: { value: MINT },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));

    expect(await screen.findByText("Amount (UI)")).toBeVisible();
    expect(screen.getByText("Amount (raw)")).toBeVisible();
  });
});
