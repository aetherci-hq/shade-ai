import { execSync } from 'child_process';
import { platform, hostname, cpus, totalmem, freemem, uptime } from 'os';

export default {
  name: 'system_info',
  description: 'Get system information including OS, CPU, memory, and uptime',
  source: 'specter',
  parameters: {
    section: { type: 'string', description: 'Section to query: all, cpu, memory, disk, network', optional: true },
  },
  async execute(params: { section?: string }) {
    const section = params.section ?? 'all';
    const info: Record<string, unknown> = {};

    if (section === 'all' || section === 'cpu') {
      const cpuInfo = cpus();
      info.cpu = {
        model: cpuInfo[0]?.model,
        cores: cpuInfo.length,
      };
    }

    if (section === 'all' || section === 'memory') {
      info.memory = {
        totalGB: (totalmem() / 1e9).toFixed(1),
        freeGB: (freemem() / 1e9).toFixed(1),
        usedPercent: ((1 - freemem() / totalmem()) * 100).toFixed(0) + '%',
      };
    }

    info.system = {
      platform: platform(),
      hostname: hostname(),
      uptimeHours: (uptime() / 3600).toFixed(1),
    };

    if (section === 'all' || section === 'disk') {
      try {
        const df = platform() === 'win32'
          ? execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf-8' })
          : execSync('df -h /', { encoding: 'utf-8' });
        info.disk = df.trim();
      } catch { info.disk = 'unavailable'; }
    }

    return info;
  },
};
