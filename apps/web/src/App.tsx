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
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 border-b border-slate-800 pb-6">
          <p className="mb-2 font-mono text-sm text-cyan-400">
            READ-ONLY SOLANA DIAGNOSTICS
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            Token-2022 Preflight
          </h1>
          <p className="mt-3 max-w-2xl text-slate-400">
            Explain what a token changes in your transfer flow before you
            integrate it.
          </p>
        </header>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <form
            onSubmit={submit}
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-6"
          >
            <div className="mb-6 flex gap-2" aria-label="Analysis mode">
              {(["basic", "transfer"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`rounded-md px-4 py-2 font-medium ${mode === value ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}
                >
                  {value === "basic" ? "Basic" : "Transfer"}
                </button>
              ))}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Mint address"
                value={form.mint}
                required
                onChange={(mint) => setForm({ ...form, mint })}
              />
              <label className="grid gap-2 text-sm font-medium">
                Cluster
                <select
                  aria-label="Cluster"
                  value={form.cluster}
                  onChange={(event) =>
                    setForm({ ...form, cluster: event.target.value as Cluster })
                  }
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-3"
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
              disabled={mutation.isPending}
              className="mt-6 rounded-md bg-cyan-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-60"
            >
              {mutation.isPending ? "Running…" : "Run preflight"}
            </button>
            {mutation.isError && (
              <p
                role="alert"
                className="mt-4 rounded-md border border-red-700 bg-red-950 p-3 text-red-200"
              >
                {mutation.error.message}
              </p>
            )}
          </form>

          <aside className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="font-semibold">Equivalent CLI command</h2>
            <code className="mt-3 block break-all rounded-md bg-slate-950 p-3 text-sm text-cyan-300">
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
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <input
        aria-label={label}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-sm"
      />
    </label>
  );
}

function Report({ report }: { report: PreflightReport }): React.JSX.Element {
  const json = JSON.stringify(report, null, 2);
  return (
    <section className="mt-8 space-y-6" aria-live="polite">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <p className="text-sm text-slate-400">Overall status</p>
        <h2
          className={`mt-1 text-3xl font-semibold ${statusClass(report.overallStatus)}`}
        >
          {report.overallStatus.replace("_", " ")}
        </h2>
        {report.transfer && (
          <dl className="mt-5 grid grid-cols-3 gap-4 font-mono text-sm">
            <Metric label="Send" value={report.transfer.amountRaw} />
            <Metric label="Fee" value={report.transfer.expectedFeeRaw} />
            <Metric
              label="Receive"
              value={report.transfer.expectedReceivedRaw}
            />
          </dl>
        )}
      </div>
      <div className="grid gap-4">
        <h2 className="text-xl font-semibold">Findings</h2>
        {report.findings.length === 0 && (
          <p className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            No blockers found by supported checks.
          </p>
        )}
        {report.findings.map((finding) => (
          <article
            key={finding.id}
            className="rounded-xl border border-slate-800 bg-slate-900 p-5"
          >
            <p
              className={`text-sm font-semibold ${statusClass(finding.status)}`}
            >
              {finding.status.replace("_", " ")}
            </p>
            <h3 className="mt-1 text-lg font-semibold">{finding.title}</h3>
            <p className="mt-2 text-slate-400">{finding.summary}</p>
            <details className="mt-4">
              <summary className="cursor-pointer font-medium">Evidence</summary>
              <ul className="mt-3 space-y-2">
                {finding.evidence.map((item, index) => (
                  <li
                    key={`${item.field}-${index}`}
                    className="rounded bg-slate-950 p-3 font-mono text-xs"
                  >
                    <span className="block text-cyan-300">{item.field}</span>
                    <span>{String(item.value)}</span>
                    <span className="block text-slate-500">{item.account}</span>
                  </li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="font-semibold">Limitations</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-400">
          {report.limitations.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">JSON report</h2>
          <CopyButton value={json} label="Copy JSON" />
        </div>
        <pre className="mt-3 max-h-96 overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-300">
          {json}
        </pre>
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
    <div>
      <dt className="text-slate-500">{label}</dt>
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
      className="mt-3 text-sm text-cyan-400"
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
    throw new Error(
      response.status === 400
        ? "Check the entered addresses and amount."
        : "Unexpected preflight error.",
    );
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
    ? "text-red-400"
    : status === "ACTION_REQUIRED" || status === "WARNING"
      ? "text-amber-300"
      : status === "UNKNOWN"
        ? "text-fuchsia-300"
        : "text-emerald-300";
}
