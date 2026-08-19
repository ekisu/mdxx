import { useState } from "react";
import { PieChart } from "react-minimal-pie-chart@9.1.2";

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

interface PipelineNode {
  id: string;
  label: string;
  x: number;
  y: number;
  tone?: string;
}

interface PipelineLink {
  source: PipelineNode;
  target: PipelineNode;
}

const graphNodes: PipelineNode[] = [
  { id: "source", label: "document.mdx", x: 90, y: 165, tone: "source" },
  { id: "validate", label: "graph + lock", x: 270, y: 165 },
  { id: "compile", label: "Bun + MDX", x: 450, y: 165, tone: "compile" },
  { id: "server", label: "SSR bundle", x: 630, y: 85, tone: "output" },
  { id: "browser", label: "browser bundle", x: 630, y: 245, tone: "output" },
];

const byId = Object.fromEntries(graphNodes.map((node) => [node.id, node]));
const graphLinks: PipelineLink[] = [
  { source: byId.source as PipelineNode, target: byId.validate as PipelineNode },
  { source: byId.validate as PipelineNode, target: byId.compile as PipelineNode },
  { source: byId.compile as PipelineNode, target: byId.server as PipelineNode },
  { source: byId.compile as PipelineNode, target: byId.browser as PipelineNode },
];

const nodeDescriptions: Record<string, string> = {
  source: "The authored MDX, strict frontmatter, local modules, and asset references form the declared source graph.",
  validate: "Discovery rejects forbidden imports and checks lock freshness before any document code executes.",
  compile: "One pinned MDX and Bun pipeline creates matching server and browser module graphs.",
  server: "A cleared-environment subprocess renders deterministic initial markup twice and compares it.",
  browser: "The inlined client bundle hydrates the same component tree and activates interactions.",
};

function ArchitectureGraph() {
  const [selected, setSelected] = useState("compile");
  return (
    <figure className="architecture-card">
      <figcaption><span>Pipeline / local React</span><strong>Select a pipeline node</strong></figcaption>
      <svg className="network-graph" viewBox="0 0 720 330" role="img" aria-label="mdxx document processing architecture">
        <defs><marker id="network-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
        {graphLinks.map((link) => <line key={`${link.source.id}-${link.target.id}`} className="network-link" x1={link.source.x} y1={link.source.y} x2={link.target.x} y2={link.target.y} markerEnd="url(#network-arrow)" />)}
        {graphNodes.map((node) => (
          <g key={node.id} className={`network-node ${node.tone ?? ""} ${selected === node.id ? "selected" : ""}`} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} aria-label={`Inspect ${node.id}`} onClick={() => setSelected(node.id)} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setSelected(node.id);
            }}>
            <rect x="-68" y="-29" width="136" height="58" rx="3" />
            <text textAnchor="middle" dominantBaseline="middle">{node.label}</text>
          </g>
        ))}
      </svg>
      <div className="node-inspector" aria-live="polite"><span>{selected}</span><p>{nodeDescriptions[selected]}</p></div>
    </figure>
  );
}

function DeliveryBars() {
  const capabilities = [
    { label: "Format contract", value: 100, color: "#65e8bf", note: "Strict YAML, source digests, canonical locks, and stable diagnostics." },
    { label: "SSR + hydration", value: 94, color: "#6bb8ff", note: "Matching server and browser trees with an interaction-level DOM test." },
    { label: "Dependency locks", value: 88, color: "#f0bc5e", note: "Frozen Bun state, complete graph comparison, and target compatibility." },
    { label: "Asset pipeline", value: 86, color: "#ee806f", note: "SHA-256 names, deduplication, CSS rewriting, and remote URL reports." },
    { label: "Isolation baseline", value: 72, color: "#a98bea", note: "Cleared environment and process limits; OS sandboxing remains external." },
  ];
  const [selected, setSelected] = useState(capabilities[0] as typeof capabilities[number]);
  return (
    <figure className="delivery-card">
      <figcaption><span>Pie Chart / imported from npm</span><strong>Version-one confidence</strong></figcaption>
      <div className="readiness-donut">
        <PieChart
          data={capabilities.map((item) => ({ title: item.label, value: item.value, color: item.color }))}
          lineWidth={22}
          paddingAngle={2}
          rounded
          startAngle={-90}
          segmentsTabIndex={0}
          segmentsShift={(index) => capabilities[index]?.label === selected.label ? 2 : 0}
          onClick={(_, index) => {
            const capability = capabilities[index];
            if (capability) setSelected(capability);
          }}
        />
        <div><strong>{selected.value}%</strong><span>ready</span></div>
      </div>
      <div className="bar-chart">
        {capabilities.map((item) => (
          <button className={`bar-row ${selected.label === item.label ? "selected" : ""}`} key={item.label} onClick={() => setSelected(item)} aria-pressed={selected.label === item.label}>
            <div><span>{item.label}</span><strong>{item.value}</strong></div>
            <div className="bar-track"><span style={{ width: `${item.value}%` }} /></div>
          </button>
        ))}
      </div>
      <div className="capability-detail" aria-live="polite"><strong>{selected.value}% / {selected.label}</strong><p>{selected.note}</p></div>
      <p className="chart-note"><span />Select a segment or bar to inspect its evidence.</p>
    </figure>
  );
}

export function SystemGraphs() {
  return <div className="graph-grid"><ArchitectureGraph /><DeliveryBars /></div>;
}
