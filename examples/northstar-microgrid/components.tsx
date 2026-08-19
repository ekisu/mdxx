import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ReactFlow, Background, Controls, MarkerType, type Edge, type Node } from "@xyflow/react@12.11.3";
import "@xyflow/react@12.11.3/dist/style.css";
import "@fontsource-variable/manrope@5.3.0";
import "@fontsource-variable/newsreader@5.3.0";
import "@fontsource/dm-mono@5.3.0/400.css";
import "@fontsource/dm-mono@5.3.0/500.css";
import { AreaClosed, Bar, LinePath, Pie } from "@visx/shape@4.0.0";
import { curveMonotoneX } from "@visx/curve@4.0.0";
import { scaleLinear } from "@visx/scale@4.0.0";
import * as echarts from "echarts@5.6.0/dist/echarts.esm.min.js";

const equipment = {
  solar: { label: "Solar field A", metric: "4.8 MWp", status: "Producing", note: "11,520 bifacial modules; east-west rows flatten the evening ramp." },
  inverter: { label: "Inverter hall", metric: "4 × 1.25 MVA", status: "Synchronized", note: "Grid-forming firmware passed a 620 kW step test without protection pickup." },
  battery: { label: "Battery banks", metric: "8.4 MWh", status: "74% SOC", note: "Two independent LFP banks provide 4.2 MW of fast frequency response." },
  bus: { label: "11 kV main bus", metric: "10 MVA", status: "Nominal", note: "Sectionalized switchgear allows either battery bank to black-start critical feeders." },
  hospital: { label: "Hospital feeder", metric: "0.62 MW", status: "Protected", note: "Priority one. Transfer test completed in 38 ms with no clinical equipment alarms." },
  water: { label: "Desalination", metric: "0.91 MW", status: "Flexible", note: "Four pump trains can shift six operating hours into the solar shoulder." },
  harbor: { label: "Harbor + homes", metric: "2.31 MW", status: "Stable", note: "Evening ferry charging is capped during low-state-of-charge operation." },
} as const;

type EquipmentId = keyof typeof equipment;

const nodes: Node[] = [
  { id: "solar", position: { x: 0, y: 20 }, data: { label: "SOLAR / A" }, className: "source-node" },
  { id: "inverter", position: { x: 205, y: 20 }, data: { label: "INVERTER HALL" } },
  { id: "battery", position: { x: 205, y: 175 }, data: { label: "BATTERY / A+B" }, className: "storage-node" },
  { id: "bus", position: { x: 430, y: 95 }, data: { label: "11 kV BUS" }, className: "bus-node" },
  { id: "hospital", position: { x: 665, y: 0 }, data: { label: "HOSPITAL" }, className: "critical-node" },
  { id: "water", position: { x: 665, y: 105 }, data: { label: "DESALINATION" } },
  { id: "harbor", position: { x: 665, y: 210 }, data: { label: "HARBOR + HOMES" } },
];

const edges: Edge[] = [
  ["solar", "inverter", "solar-feed"], ["inverter", "bus", "inverter-feed"], ["battery", "bus", "battery-feed"],
  ["bus", "hospital", "hospital-feed"], ["bus", "water", "water-feed"], ["bus", "harbor", "harbor-feed"],
].map(([source, target, id]) => ({ id: id!, source: source!, target: target!, markerEnd: { type: MarkerType.ArrowClosed }, animated: id === "battery-feed" }));

const hours = Array.from({ length: 24 }, (_, hour) => {
  const daylight = Math.max(0, Math.sin(((hour - 6) / 13) * Math.PI));
  const demand = 1.72 + (hour >= 6 && hour <= 9 ? 0.58 : 0) + (hour >= 17 && hour <= 22 ? 1.22 : 0) + Math.sin(hour * 1.7) * 0.08;
  const solar = daylight * 4.45;
  const battery = Math.max(-1.25, Math.min(1.42, demand - solar - 0.24));
  return { hour, demand, solar, battery };
});

const dayNames = ["MON 08", "TUE 09", "WED 10", "THU 11", "FRI 12", "SAT 13", "SUN 14"];
const stressData = dayNames.flatMap((_, day) => hours.map(({ hour, demand, solar }) => {
  const cloudPenalty = [0.04, 0.16, 0.42, 0.58, 0.31, 0.12, 0.07][day] ?? 0;
  const stress = Math.round(Math.min(100, 18 + demand * 12 + Math.max(0, demand - solar * (1 - cloudPenalty)) * 14));
  return [hour, day, stress];
}));

const heatmapOption = {
  animation: false,
  grid: { left: 70, right: 20, top: 16, bottom: 52 },
  tooltip: { trigger: "item", backgroundColor: "#0b1718", borderColor: "#43605c", textStyle: { color: "#dce9e5", fontFamily: "monospace" } },
  xAxis: { type: "category", data: hours.map(({ hour }) => hour.toString().padStart(2, "0")), axisLine: { lineStyle: { color: "#314845" } }, axisLabel: { color: "#6f8582", interval: 2 } },
  yAxis: { type: "category", data: dayNames, axisLine: { lineStyle: { color: "#314845" } }, axisLabel: { color: "#8da09d", fontFamily: "monospace", fontSize: 10 } },
  visualMap: { min: 30, max: 100, calculable: false, orient: "horizontal", left: "center", bottom: 0, textStyle: { color: "#718481" }, inRange: { color: ["#17322f", "#32736a", "#f2c84b", "#f46f52"] } },
  series: [{ type: "heatmap", data: stressData, itemStyle: { borderColor: "#0a1214", borderWidth: 2 }, emphasis: { itemStyle: { borderColor: "#fff", borderWidth: 2 } } }],
};

export function NetworkTopology() {
  const [selected, setSelected] = useState<EquipmentId>("battery");
  const item = equipment[selected];
  return (
    <div className="topology-frame" aria-label="Interactive microgrid topology">
        <div className="flow-canvas">
          <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.65} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => setSelected(node.id as EquipmentId)} proOptions={{ hideAttribution: true }}>
            <Background color="#29413f" gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className="equipment-readout" aria-live="polite">
          <span className="readout-label">Selected asset / {selected}</span>
          <h3>{item.label}</h3>
          <strong>{item.metric}</strong>
          <div><i />{item.status}</div>
          <p>{item.note}</p>
        </aside>
    </div>
  );
}

export function DispatchChart() {
  const [selectedHour, setSelectedHour] = useState(18);
  const width = 920;
  const height = 330;
  const margin = { top: 22, right: 22, bottom: 38, left: 46 };
  const x = scaleLinear({ domain: [0, 23], range: [margin.left, width - margin.right] });
  const y = scaleLinear({ domain: [-1.5, 5], range: [height - margin.bottom, margin.top] });
  const selected = hours[selectedHour]!;
  return (
    <figure className="dispatch-card">
        <figcaption><span>Five-minute telemetry / normalized to hourly mean</span><strong>{selectedHour.toString().padStart(2, "0")}:00 selected</strong></figcaption>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily solar, demand, and battery dispatch chart">
          <defs>
            <linearGradient id="solar-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f2c84b" stopOpacity=".48" /><stop offset="1" stopColor="#f2c84b" stopOpacity=".02" /></linearGradient>
            <linearGradient id="demand-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f46f52" stopOpacity=".2" /><stop offset="1" stopColor="#f46f52" stopOpacity="0" /></linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((tick) => <g key={tick}><line className="chart-gridline" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} /><text className="axis-label" x={margin.left - 12} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
          <AreaClosed data={hours} x={(d) => x(d.hour)} y={(d) => y(d.solar)} yScale={y} curve={curveMonotoneX} fill="url(#solar-fill)" />
          <AreaClosed data={hours} x={(d) => x(d.hour)} y={(d) => y(d.demand)} yScale={y} curve={curveMonotoneX} fill="url(#demand-fill)" />
          <LinePath data={hours} x={(d) => x(d.hour)} y={(d) => y(d.solar)} curve={curveMonotoneX} stroke="#f2c84b" strokeWidth={3} />
          <LinePath data={hours} x={(d) => x(d.hour)} y={(d) => y(d.demand)} curve={curveMonotoneX} stroke="#f46f52" strokeWidth={3} />
          <line className="selection-line" x1={x(selectedHour)} x2={x(selectedHour)} y1={margin.top} y2={height - margin.bottom} />
          {hours.map((point) => <Bar key={point.hour} x={x(point.hour) - 15} y={margin.top} width={30} height={height - margin.top - margin.bottom} fill="transparent" onClick={() => setSelectedHour(point.hour)} className="hour-hit" />)}
          {[0, 4, 8, 12, 16, 20, 23].map((tick) => <text key={tick} className="axis-label" x={x(tick)} y={height - 13} textAnchor="middle">{tick.toString().padStart(2, "0")}</text>)}
        </svg>
        <div className="dispatch-readout">
          <div><span>Demand</span><strong>{selected.demand.toFixed(2)} MW</strong></div>
          <div><span>Solar</span><strong>{selected.solar.toFixed(2)} MW</strong></div>
          <div><span>Battery</span><strong>{selected.battery > 0 ? "+" : ""}{selected.battery.toFixed(2)} MW</strong></div>
          <div><span>Reserve</span><strong>{Math.max(12, 68 - selected.demand * 9).toFixed(0)} min</strong></div>
        </div>
    </figure>
  );
}

function SupplyMix() {
  const mix = [
    { title: "Direct solar", value: 58, color: "#f2c84b" },
    { title: "Battery discharge", value: 24, color: "#63d8c2" },
    { title: "Diesel reserve", value: 7, color: "#f46f52" },
    { title: "Curtailment", value: 11, color: "#576a70" },
  ];
  const [selected, setSelected] = useState(0);
  return (
    <figure className="mix-card">
      <figcaption><span>Delivered energy / seven-day window</span><strong>Energy ledger</strong></figcaption>
      <div className="mix-graphic">
        <svg viewBox="0 0 240 240" role="img" aria-label="Delivered energy composition">
          <circle className="ledger-orbit" cx="120" cy="120" r="105" />
          {Array.from({ length: 48 }, (_, index) => {
            const angle = index / 48 * Math.PI * 2;
            const inner = index % 6 === 0 ? 101 : 104;
            return <line key={index} className="ledger-tick" x1={120 + Math.cos(angle) * inner} y1={120 + Math.sin(angle) * inner} x2={120 + Math.cos(angle) * 109} y2={120 + Math.sin(angle) * 109} />;
          })}
          <g transform="translate(120 120) rotate(-90)">
            <Pie data={mix} pieValue={(item) => item.value} outerRadius={92} innerRadius={68} padAngle={0.025}>
              {(pie) => pie.arcs.map((arc, index) => (
                <path
                  key={arc.data.title}
                  d={pie.path(arc) ?? undefined}
                  fill={arc.data.color}
                  className={index === selected ? "ledger-segment selected" : "ledger-segment"}
                  role="button"
                  tabIndex={0}
                  aria-label={`${arc.data.title}: ${arc.data.value}%`}
                  onClick={() => setSelected(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelected(index);
                  }}
                />
              ))}
            </Pie>
          </g>
          <circle className="ledger-core" cx="120" cy="120" r="56" />
          <text className="ledger-value" x="120" y="116" textAnchor="middle">{mix[selected]!.value}%</text>
          <text className="ledger-label" x="120" y="138" textAnchor="middle">{mix[selected]!.title}</text>
        </svg>
      </div>
      <ul>{mix.map((item, index) => <li key={item.title} className={index === selected ? "selected" : ""} onClick={() => setSelected(index)}><i style={{ background: item.color }} /><span>{item.title}</span><strong>{item.value}%</strong></li>)}</ul>
    </figure>
  );
}

function StressHeatmap() {
  const [selection, setSelection] = useState({ day: 3, hour: 18, value: stressData.find((item) => item[0] === 18 && item[1] === 3)?.[2] ?? 0 });
  const chartElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chartElement.current) return;
    const chart = echarts.init(chartElement.current);
    chart.setOption(heatmapOption);
    chart.on("click", (params) => {
      const data = params.data as number[];
      setSelection({ hour: data[0]!, day: data[1]!, value: data[2]! });
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartElement.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, []);
  return (
    <figure className="stress-card">
      <figcaption><span>Canvas heatmap / click to inspect</span><strong>Operational stress index</strong></figcaption>
      <div ref={chartElement} style={{ height: 340 }} />
      <div className="stress-selection"><span>{dayNames[selection.day]} / {selection.hour.toString().padStart(2, "0")}:00</span><strong>{selection.value}</strong><p>{selection.value > 80 ? "Reserve intervention likely" : selection.value > 60 ? "Storage carries the ramp" : "Operating margin available"}</p></div>
    </figure>
  );
}

export function EnergyAnalytics() {
  return <section className="analytics-grid"><SupplyMix /><StressHeatmap /></section>;
}

const SimulationPanel = lazy(() => import("./simulation.tsx"));

export function ResilienceLab() {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="open-lab" onClick={() => setOpen(true)}><span>Load advanced analysis</span><strong>Open resilience lab →</strong><small>Separate browser chunk / deterministic Worker</small></button>;
  return <Suspense fallback={<div className="lab-loading">Loading simulation module…</div>}><SimulationPanel /></Suspense>;
}
