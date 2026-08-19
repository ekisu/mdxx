import { useEffect, useRef, useState } from "react";

interface SimulationResult {
  reliability: number;
  diesel: number;
  reserve: number;
  distribution: number[];
}

const initial: SimulationResult = { reliability: 99.69, diesel: 7.1, reserve: 3.8, distribution: [4, 8, 17, 31, 42, 55, 61, 52, 36, 21, 10, 4] };

export default function SimulationPanel() {
  const worker = useRef<Worker | null>(null);
  const [cloud, setCloud] = useState(42);
  const [battery, setBattery] = useState(92);
  const [growth, setGrowth] = useState(8);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(initial);

  useEffect(() => {
    const simulation = new Worker(new URL("./simulation-worker.ts", import.meta.url), { type: "module" });
    simulation.onmessage = (event: MessageEvent<SimulationResult>) => {
      setResult(event.data);
      setRunning(false);
    };
    worker.current = simulation;
    return () => simulation.terminate();
  }, []);

  const run = () => {
    setRunning(true);
    worker.current?.postMessage({ cloud, battery, growth });
  };

  const max = Math.max(...result.distribution);
  return (
    <section className="simulation-lab">
      <div className="lab-header"><span>03 / Resilience model</span><h3>Stress the reserve.</h3><p>720 seeded operating years / fixed equipment model</p></div>
      <div className="lab-controls">
        <label><span>Persistent cloud cover <strong>{cloud}%</strong></span><input type="range" min="10" max="80" value={cloud} onChange={(event) => setCloud(Number(event.target.value))} /></label>
        <label><span>Battery availability <strong>{battery}%</strong></span><input type="range" min="55" max="100" value={battery} onChange={(event) => setBattery(Number(event.target.value))} /></label>
        <label><span>Five-year demand growth <strong>{growth}%</strong></span><input type="range" min="0" max="30" value={growth} onChange={(event) => setGrowth(Number(event.target.value))} /></label>
        <button onClick={run} disabled={running}>{running ? "Worker calculating…" : "Run 720 scenarios"}</button>
      </div>
      <div className="simulation-output" aria-live="polite">
        <div className="simulation-bars">{result.distribution.map((value, index) => <i key={index} style={{ height: `${(value / max) * 100}%` }}><span>{index + 1}</span></i>)}</div>
        <div className="simulation-metrics">
          <div><span>Service reliability</span><strong>{result.reliability.toFixed(2)}%</strong></div>
          <div><span>Diesel contribution</span><strong>{result.diesel.toFixed(1)}%</strong></div>
          <div><span>P10 reserve</span><strong>{result.reserve.toFixed(1)} h</strong></div>
        </div>
      </div>
      <p className="model-note">The distribution shows minimum overnight reserve across simulated years. Results are reproducible: the Worker resets to the same seed for every parameter set.</p>
    </section>
  );
}
