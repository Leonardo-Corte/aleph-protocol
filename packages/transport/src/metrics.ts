// A tiny dependency-free metrics registry that renders the Prometheus text
// exposition format. Counters and histograms with bounded label sets — enough
// for the four golden signals (latency, traffic, errors, saturation) plus the
// settlement/Sybil counters that matter for THIS protocol. A production
// deployment can swap in prom-client behind the same call sites.

type Labels = Record<string, string>;

function keyOf(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]!}`).join(",");
}

function renderLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return "{" + keys.map((k) => `${k}="${escapeLabel(labels[k]!)}"`).join(",") + "}";
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

export class Counter {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const k = keyOf(labels);
    const cur = this.values.get(k);
    if (cur) cur.value += by;
    else this.values.set(k, { labels, value: by });
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) lines.push(`${this.name} 0`);
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join("\n");
  }
}

export class Histogram {
  // cumulative bucket counts + sum + count, per label set
  private series = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: number[] = [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  ) {}

  observe(labels: Labels, value: number): void {
    const k = keyOf(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { labels, counts: new Array<number>(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    s.sum += value;
    s.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) s.counts[i]! += 1;
    }
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const s of this.series.values()) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative = s.counts[i]!; // counts are already "<= bucket", monotonic
        lines.push(
          `${this.name}_bucket${renderLabels({ ...s.labels, le: String(this.buckets[i]) })} ${cumulative}`,
        );
      }
      lines.push(`${this.name}_bucket${renderLabels({ ...s.labels, le: "+Inf" })} ${s.count}`);
      lines.push(`${this.name}_sum${renderLabels(s.labels)} ${s.sum}`);
      lines.push(`${this.name}_count${renderLabels(s.labels)} ${s.count}`);
    }
    return lines.join("\n");
  }
}

export class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private histograms = new Map<string, Histogram>();

  counter(name: string, help: string): Counter {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name, help);
      this.counters.set(name, c);
    }
    return c;
  }

  histogram(name: string, help: string, buckets?: number[]): Histogram {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, help, buckets);
      this.histograms.set(name, h);
    }
    return h;
  }

  // Prometheus text exposition format (what GET /metrics returns).
  render(): string {
    const blocks: string[] = [];
    for (const c of this.counters.values()) blocks.push(c.render());
    for (const h of this.histograms.values()) blocks.push(h.render());
    return blocks.join("\n") + "\n";
  }
}
