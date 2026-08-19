import { useState, type KeyboardEvent } from "react";

interface Phase {
  id: string;
  label: string;
  window: string;
  progress: number;
  tone: string;
  summary: string;
  outcomes: string[];
}

const phases: Phase[] = [
  {
    id: "foundation",
    label: "Foundation",
    window: "Weeks 1-2",
    progress: 100,
    tone: "mint",
    summary: "The document contract and command surface become stable.",
    outcomes: ["Strict YAML and lock parsing", "CLI diagnostics and atomic writes", "Deterministic import discovery"],
  },
  {
    id: "renderer",
    label: "Renderer",
    window: "Weeks 3-4",
    progress: 92,
    tone: "sky",
    summary: "Authored MDX becomes server-rendered, interactive HTML.",
    outcomes: ["Typed inline components", "SSR in a worker subprocess", "Browser hydration and CSS bundling"],
  },
  {
    id: "supply-chain",
    label: "Supply chain",
    window: "Weeks 5-6",
    progress: 84,
    tone: "amber",
    summary: "Dependencies and assets become inspectable build inputs.",
    outcomes: ["Frozen Bun dependency graph", "Integrity and target checks", "Content-addressed local assets"],
  },
  {
    id: "hardening",
    label: "Hardening",
    window: "Weeks 7-8",
    progress: 68,
    tone: "coral",
    summary: "Acceptance tests turn the format contract into evidence.",
    outcomes: ["Cross-directory byte comparison", "Hydration interaction tests", "Isolation and failure limits"],
  },
];

export function PhaseExplorer() {
  const [active, setActive] = useState(phases[0] as Phase);
  return (
    <div className="phase-explorer">
      <div className="phase-tabs" role="tablist" aria-label="Delivery phases">
        {phases.map((phase, index) => (
          <button
            key={phase.id}
            className={active.id === phase.id ? "phase-tab active" : "phase-tab"}
            onClick={() => setActive(phase)}
            role="tab"
            aria-selected={active.id === phase.id}
          >
            <span className="phase-number">0{index + 1}</span>
            <span><strong>{phase.label}</strong><small>{phase.window}</small></span>
            <span className={`status-dot ${phase.tone}`} />
          </button>
        ))}
      </div>
      <article className={`phase-detail ${active.tone}`} role="tabpanel">
        <div className="phase-detail-top"><span>{active.window}</span><strong>{active.progress}%</strong></div>
        <div className="progress-track"><span style={{ width: `${active.progress}%` }} /></div>
        <h3>{active.label}</h3>
        <p>{active.summary}</p>
        <ul>{active.outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}</ul>
      </article>
    </div>
  );
}

function ArchitectureGraph() {
  const descriptions: Record<string, string> = {
    source: "The authored MDX, strict frontmatter, local modules, and asset references form the declared source graph.",
    validate: "Discovery rejects forbidden imports and checks lock freshness before any document code executes.",
    compile: "One pinned MDX and Bun pipeline creates matching server and browser module graphs.",
    server: "A cleared-environment subprocess renders deterministic initial markup twice and compares it.",
    browser: "The inlined client bundle hydrates the same component tree and activates interactions.",
  };
  const [selected, setSelected] = useState("compile");
  return (
    <figure className="architecture-card">
      <figcaption><span>Execution model</span><strong>One pipeline, two bundles</strong></figcaption>
      <svg viewBox="0 0 760 330" role="img" aria-labelledby="architecture-title">
        <title id="architecture-title">mdxx document processing architecture</title>
        <defs>
          <linearGradient id="flow" x1="0" x2="1"><stop offset="0" stopColor="#65e8bf"/><stop offset="1" stopColor="#6bb8ff"/></linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <g className="flow-lines" fill="none" stroke="url(#flow)" strokeWidth="3"><path d="M170 165 H265"/><path d="M405 165 H470"/><path d="M610 135 H680 V72"/><path d="M610 195 H680 V258"/></g>
        <GraphNode id="source" selected={selected === "source"} onSelect={setSelected} className="source" x={20} y={105} width={150} height={120} label="SOURCE" main="document.mdx" note="frontmatter + code" />
        <GraphNode id="validate" selected={selected === "validate"} onSelect={setSelected} x={265} y={105} width={140} height={120} label="VALIDATE" main="graph + lock" note="reject undeclared input" />
        <GraphNode id="compile" selected={selected === "compile"} onSelect={setSelected} className="active" x={470} y={105} width={140} height={120} label="COMPILE" main="Bun + MDX" note="shared module graph" glow />
        <GraphNode id="server" selected={selected === "server"} onSelect={setSelected} className="output" x={620} y={20} width={120} height={84} label="SERVER" main="SSR" />
        <GraphNode id="browser" selected={selected === "browser"} onSelect={setSelected} className="output" x={620} y={226} width={120} height={84} label="BROWSER" main="hydrate" />
      </svg>
      <div className="graph-legend"><span><i className="legend-source"/>authored input</span><span><i className="legend-process"/>deterministic process</span><span><i className="legend-output"/>generated output</span></div>
      <div className="node-inspector" aria-live="polite"><span>{selected}</span><p>{descriptions[selected]}</p></div>
    </figure>
  );
}

interface GraphNodeProps {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  main: string;
  note?: string;
  className?: string;
  glow?: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}

function GraphNode({ id, x, y, width, height, label, main, note, className = "", glow = false, selected, onSelect }: GraphNodeProps) {
  const center = x + width / 2;
  const activate = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  };
  return (
    <g className={`graph-node ${className} ${selected ? "selected" : ""}`} filter={glow ? "url(#glow)" : undefined} role="button" tabIndex={0} aria-label={`Inspect ${label.toLowerCase()}`} onClick={() => onSelect(id)} onKeyDown={activate}>
      <rect x={x} y={y} width={width} height={height} rx="18"/>
      <text x={center} y={y + 43} textAnchor="middle">{label}</text>
      <text x={center} y={y + 73} textAnchor="middle" className="node-main">{main}</text>
      {note ? <text x={center} y={y + 97} textAnchor="middle" className="node-note">{note}</text> : null}
    </g>
  );
}

function DeliveryBars() {
  const capabilities = [
    { label: "Format contract", value: 100, note: "Strict YAML, source digests, canonical locks, and stable diagnostics." },
    { label: "SSR + hydration", value: 94, note: "Matching server and browser trees with an interaction-level DOM test." },
    { label: "Dependency locks", value: 88, note: "Frozen Bun state, complete graph comparison, and target compatibility." },
    { label: "Asset pipeline", value: 86, note: "SHA-256 names, deduplication, CSS rewriting, and remote URL reports." },
    { label: "Isolation baseline", value: 72, note: "Cleared environment and process limits; OS sandboxing remains external." },
  ];
  const [selected, setSelected] = useState(capabilities[0] as typeof capabilities[number]);
  return (
    <figure className="delivery-card">
      <figcaption><span>Readiness by capability</span><strong>Version-one confidence</strong></figcaption>
      <div className="bar-chart">
        {capabilities.map((item) => (
          <button className={`bar-row ${selected.label === item.label ? "selected" : ""}`} key={item.label} onClick={() => setSelected(item)} aria-pressed={selected.label === item.label}>
            <div><span>{item.label}</span><strong>{item.value}</strong></div>
            <div className="bar-track"><span style={{ width: `${item.value}%` }} /></div>
          </button>
        ))}
      </div>
      <div className="capability-detail" aria-live="polite"><strong>{selected.value}% / {selected.label}</strong><p>{selected.note}</p></div>
      <p className="chart-note"><span />Select a bar to inspect its evidence.</p>
    </figure>
  );
}

export function SystemGraphs() {
  return <div className="graph-grid"><ArchitectureGraph /><DeliveryBars /></div>;
}
