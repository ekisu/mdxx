interface ScenarioRequest {
  cloud: number;
  battery: number;
  growth: number;
}

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

self.onmessage = (event: MessageEvent<ScenarioRequest>) => {
  const { cloud, battery, growth } = event.data;
  const random = randomGenerator(0x4e534930 + cloud * 101 + battery * 17 + growth);
  const buckets = Array.from({ length: 12 }, () => 0);
  let failures = 0;
  let dieselTotal = 0;
  let reserveTotal = 0;

  for (let scenario = 0; scenario < 720; scenario++) {
    const weather = cloud / 100 * (0.72 + random() * 0.58);
    const outage = random() > battery / 100 ? 0.46 + random() * 0.38 : 0;
    const demand = 1 + growth / 100 * (0.7 + random() * 0.6);
    const reserve = Math.max(0, 11.8 * (battery / 100) * (1 - weather * 0.64) - outage * 5.2 - (demand - 1) * 18 + random() * 2.4);
    const diesel = Math.max(0, 4.1 + weather * 9.8 + outage * 8.2 + (demand - 1) * 22 - reserve * 0.18);
    if (reserve < 0.65 && random() < 0.22) failures++;
    dieselTotal += diesel;
    reserveTotal += reserve;
    buckets[Math.min(11, Math.floor(reserve))] = (buckets[Math.min(11, Math.floor(reserve))] ?? 0) + 1;
  }

  self.postMessage({
    reliability: 100 - failures / 7.2,
    diesel: dieselTotal / 720,
    reserve: reserveTotal / 720,
    distribution: buckets,
  });
};
