import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";

import type {
  Cluster,
  FindingStatus,
  PreflightReport,
} from "@token2022-preflight/core";

type Mode = "basic" | "transfer";

interface FormState {
  cluster: Cluster;
  mint: string;
  amountUi: string;
  sourceTokenAccount: string;
  destinationTokenAccount: string;
}

const INITIAL_FORM: FormState = {
  cluster: "mainnet-beta",
  mint: "",
  amountUi: "",
  sourceTokenAccount: "",
  destinationTokenAccount: "",
};

export function App(): React.JSX.Element {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <PreflightPage />
    </QueryClientProvider>
  );
}

function PreflightPage(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>("basic");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const mutation = useMutation({ mutationFn: runPreflight });
  const cliCommand = useMemo(() => buildCliCommand(form, mode), [form, mode]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    mutation.mutate({ form, mode });
  }

  return (
    <main className="app-shell min-h-screen px-4 py-6 sm:px-6 lg:py-10">
      <div className="mx-auto max-w-6xl">
        <nav className="console-nav" aria-label="Product">
          <span className="brand-mark">T22</span>
          <span className="brand-name">TOKEN-2022 PREFLIGHT</span>
          <span className="nav-state">● RPC / READ ONLY</span>
        </nav>

        <header className="console-hero">
          <div className="window-bar" aria-hidden="true">
            <span className="window-dot window-dot-red" />
            <span className="window-dot window-dot-amber" />
            <span className="window-dot window-dot-green" />
            <span className="window-path">~/token22/preflight</span>
          </div>
          <div className="hero-copy">
            <p className="eyebrow">TRANSFER COMPATIBILITY INSPECTOR / v0.1.0</p>
            <h1>Know what the mint changes before your transfer ships.</h1>
            <p className="hero-description">
              Paste account addresses into a familiar web form. Get a
              deterministic report built from live Solana account data — no
              signing, no transaction submission.
            </p>
          </div>
        </header>

        <section className="workspace-grid">
          <form onSubmit={submit} className="console-panel input-panel">
            <div className="panel-label">/ INPUT PARAMETERS</div>
            <div className="mode-switch" aria-label="Analysis mode">
              {(["basic", "transfer"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={value === "basic" ? "Basic" : "Transfer"}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                  className={`mode-button ${mode === value ? "mode-button-active" : ""}`}
                >
                  {value === "basic" ? "MINT ONLY" : "TRANSFER PATH"}
                </button>
              ))}
            </div>
            <div className="field-grid">
              <Field
                label="Mint address"
                value={form.mint}
                required
                onChange={(mint) => setForm({ ...form, mint })}
              />
              <label className="field-label">
                <span>Cluster</span>
                <select
                  aria-label="Cluster"
                  value={form.cluster}
                  onChange={(event) =>
                    setForm({ ...form, cluster: event.target.value as Cluster })
                  }
                  className="console-control"
                >
                  <option value="mainnet-beta">mainnet-beta</option>
                  <option value="devnet">devnet</option>
                </select>
              </label>
              <Field
                label="Amount (UI units)"
                value={form.amountUi}
                onChange={(amountUi) => setForm({ ...form, amountUi })}
              />
              {mode === "transfer" && (
                <>
                  <Field
                    label="Source token account"
                    value={form.sourceTokenAccount}
                    required
                    onChange={(sourceTokenAccount) =>
                      setForm({ ...form, sourceTokenAccount })
                    }
                  />
                  <Field
                    label="Destination token account"
                    value={form.destinationTokenAccount}
                    required
                    onChange={(destinationTokenAccount) =>
                      setForm({ ...form, destinationTokenAccount })
                    }
                  />
                </>
              )}
            </div>
            <button
              type="submit"
              aria-label="Run preflight"
              disabled={mutation.isPending}
              className="run-button"
            >
              {mutation.isPending ? "[ PROCESSING ]" : "> RUN PREFLIGHT"}
            </button>
            {mutation.isError && (
              <p role="alert" className="error-callout">
                {mutation.error.message}
              </p>
            )}
          </form>

          <aside className="console-panel command-panel">
            <div className="panel-label">/ CLI EQUIVALENT</div>
            <h2>Same analysis, scriptable.</h2>
            <p className="panel-description">
              The website stays form-first. Copy this only when you need the
              identical check in a terminal or CI job.
            </p>
            <code className="command-preview">
              <span aria-hidden="true">$ </span>
              {cliCommand}
            </code>
            <CopyButton value={cliCommand} label="Copy CLI command" />
          </aside>
        </section>

        {mutation.data && <Report report={mutation.data} />}
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  required = false,
  onChange,
}: {
  label: string;
  value: string;
  required?: boolean;
  onChange(value: string): void;
}): React.JSX.Element {
  return (
    <label className="field-label">
      <span>{label}</span>
      <input
        aria-label={label}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="console-control"
      />
    </label>
  );
}

function Report({ report }: { report: PreflightReport }): React.JSX.Element {
  const json = JSON.stringify(report, null, 2);
  return (
    <section className="report-stack" aria-live="polite">
      <div className="console-panel status-panel">
        <div>
          <p className="panel-label">/ PREFLIGHT RESULT</p>
          <h2>Transfer readiness</h2>
        </div>
        <span className={`status-badge ${statusClass(report.overallStatus)}`}>
          {statusSymbol(report.overallStatus)}{" "}
          {report.overallStatus.replace("_", " ")}
        </span>
        {report.transfer && (
          <dl className="metric-grid">
            <Metric label="Amount (UI)" value={report.input.amountUi} />
            <Metric label="Amount (raw)" value={report.transfer.amountRaw} />
            <Metric label="Fee" value={report.transfer.expectedFeeRaw} />
            <Metric
              label="Receive"
              value={report.transfer.expectedReceivedRaw}
            />
          </dl>
        )}
      </div>
      <div className="findings-section">
        <div className="section-heading">
          <p className="panel-label">/ DIAGNOSTIC TAPE</p>
          <h2>Findings</h2>
          <span>{String(report.findings.length).padStart(2, "0")} records</span>
        </div>
        {report.findings.length === 0 && (
          <p className="empty-result">
            <span className="status-badge status-ready">✓ READY</span>
            No blockers found by supported checks.
          </p>
        )}
        {report.findings.map((finding) => (
          <article key={finding.id} className="finding-row">
            <div className="finding-line">
              <span className={`status-badge ${statusClass(finding.status)}`}>
                {statusSymbol(finding.status)}{" "}
                {finding.status.replace("_", " ")}
              </span>
              <div>
                <h3>{finding.title}</h3>
                <p>{finding.summary}</p>
              </div>
              <span className="finding-id">{finding.id}</span>
            </div>
            {finding.requiredActions.length > 0 && (
              <div className="action-block">
                <h4>Required actions</h4>
                <ul>
                  {finding.requiredActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </div>
            )}
            <details className="evidence-block">
              <summary>Evidence</summary>
              <ul>
                {finding.evidence.map((item, index) => (
                  <li key={`${item.field}-${index}`}>
                    <span>{item.field}</span>
                    <strong>{String(item.value)}</strong>
                    <small>{item.account}</small>
                  </li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </div>
      <div className="console-panel limitation-panel">
        <div className="panel-label">/ KNOWN LIMITS</div>
        <h2>Limitations</h2>
        <ul>
          {report.limitations.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      </div>
      <div className="console-panel json-panel">
        <div className="json-heading">
          <div>
            <p className="panel-label">/ MACHINE OUTPUT</p>
            <h2>JSON report</h2>
          </div>
          <CopyButton value={json} label="Copy JSON" />
        </div>
        <pre>{json}</pre>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}): React.JSX.Element {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value ?? "unknown"}</dd>
    </div>
  );
}

function CopyButton({
  value,
  label,
}: {
  value: string;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard?.writeText(value)}
      className="copy-button"
    >
      {label}
    </button>
  );
}

async function runPreflight({
  form,
  mode,
}: {
  form: FormState;
  mode: Mode;
}): Promise<PreflightReport> {
  const payload = {
    cluster: form.cluster,
    mint: form.mint.trim(),
    ...(form.amountUi.trim() ? { amountUi: form.amountUi.trim() } : {}),
    ...(mode === "transfer"
      ? {
          sourceTokenAccount: form.sourceTokenAccount.trim(),
          destinationTokenAccount: form.destinationTokenAccount.trim(),
        }
      : {}),
  };
  const response = await fetch("/v1/preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    if (response.status === 429)
      throw new Error("Request rate limit reached. Try again shortly.");
    if (response.status === 502 || response.status === 503)
      throw new Error("RPC service is unavailable. Try again shortly.");
    if (response.status === 400) {
      const body = (await response.json().catch(() => null)) as {
        message?: unknown;
      } | null;
      throw new Error(
        typeof body?.message === "string"
          ? body.message
          : "Check the entered addresses and amount.",
      );
    }
    throw new Error("Unexpected preflight error.");
  }
  return (await response.json()) as PreflightReport;
}

function buildCliCommand(form: FormState, mode: Mode): string {
  const parts = [
    "token22",
    "inspect",
    form.mint || "<MINT>",
    "--cluster",
    form.cluster,
  ];
  if (form.amountUi) parts.push("--amount", form.amountUi);
  if (mode === "transfer")
    parts.push(
      "--source",
      form.sourceTokenAccount || "<SOURCE>",
      "--destination",
      form.destinationTokenAccount || "<DESTINATION>",
    );
  return parts.join(" ");
}

function statusClass(status: FindingStatus): string {
  return status === "BLOCKED"
    ? "status-blocked"
    : status === "ACTION_REQUIRED" || status === "WARNING"
      ? "status-warning"
      : status === "UNKNOWN"
        ? "status-unknown"
        : "status-ready";
}

function statusSymbol(status: FindingStatus): string {
  return status === "BLOCKED"
    ? "×"
    : status === "ACTION_REQUIRED" || status === "WARNING"
      ? "▲"
      : status === "UNKNOWN"
        ? "?"
        : "✓";
}
