import os from "node:os";

export interface CpuCoreMetrics {
  model: string;
  speed: number;
  usagePercent: number;
}

export interface SystemMetrics {
  hostname: string;
  platform: NodeJS.Platform;
  arch: string;
  uptimeSeconds: number;
  cpu: {
    model: string;
    cores: number;
    usagePercent: number;
    loadAverage: [number, number, number];
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
}

interface CpuTickSample {
  idle: number;
  total: number;
}

/**
 * Samples CPU ticks and calculates delta usage percentage over time.
 */
export class CpuSampler {
  private lastSample: CpuTickSample[] | null = null;

  constructor() {
    this.lastSample = this.getTicks();
  }

  private getTicks(): CpuTickSample[] {
    const cpus = os.cpus();
    return cpus.map((cpu) => {
      const times = cpu.times;
      const total =
        times.user + times.nice + times.sys + times.idle + times.irq;
      return { idle: times.idle, total };
    });
  }

  /**
   * Computes the CPU usage delta since the previous sample (or between two samples).
   * Returns average usage percentage (0 - 100) and per-core breakdown.
   */
  sample(): { usagePercent: number; perCore: number[] } {
    const current = this.getTicks();
    if (!this.lastSample || this.lastSample.length !== current.length) {
      this.lastSample = current;
      return { usagePercent: 0, perCore: current.map(() => 0) };
    }

    const perCore: number[] = [];
    let totalActive = 0;
    let totalTime = 0;

    for (let i = 0; i < current.length; i++) {
      const prev = this.lastSample[i];
      const cur = current[i];

      const deltaTotal = cur.total - prev.total;
      const deltaIdle = cur.idle - prev.idle;
      const deltaActive = Math.max(0, deltaTotal - deltaIdle);

      const corePercent =
        deltaTotal > 0 ? (deltaActive / deltaTotal) * 100 : 0;
      perCore.push(Math.round(corePercent * 10) / 10);

      totalActive += deltaActive;
      totalTime += deltaTotal;
    }

    this.lastSample = current;

    const usagePercent =
      totalTime > 0 ? (totalActive / totalTime) * 100 : 0;

    return {
      usagePercent: Math.round(usagePercent * 10) / 10,
      perCore,
    };
  }
}

const defaultSampler = new CpuSampler();

/**
 * Returns instant system resources and metrics (CPU, RAM, load averages, uptime).
 */
export function getSystemMetrics(sampler: CpuSampler = defaultSampler): SystemMetrics {
  const cpus = os.cpus();
  const totalmem = os.totalmem();
  const freemem = os.freemem();
  const usedmem = totalmem - freemem;
  const cpuModel = cpus[0]?.model || "Unknown CPU";

  const { usagePercent } = sampler.sample();

  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(os.uptime()),
    cpu: {
      model: cpuModel,
      cores: cpus.length,
      usagePercent,
      loadAverage: os.loadavg() as [number, number, number],
    },
    memory: {
      totalBytes: totalmem,
      freeBytes: freemem,
      usedBytes: usedmem,
      usedPercent: Math.round((usedmem / totalmem) * 1000) / 10,
    },
  };
}
