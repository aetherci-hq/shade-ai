import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import type { Agent } from './agent.js';
import type { HeartbeatState } from './types.js';
import { readMemory, appendActivity } from './memory.js';
import { eventBus } from './events.js';
import { getConfig } from './config.js';

export class HeartbeatDaemon {
  private agent: Agent;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _enabled: boolean;
  private _intervalMs: number;
  private _nextWake: number = 0;
  private _lastState: HeartbeatState | null = null;

  constructor(agent: Agent) {
    const config = getConfig();
    this.agent = agent;
    this._enabled = config.heartbeat.enabled;
    this._intervalMs = config.heartbeat.intervalMinutes * 60 * 1000;
  }

  get enabled(): boolean { return this._enabled; }
  get nextWake(): number { return this._nextWake; }
  get lastState(): HeartbeatState | null { return this._lastState; }

  start(): void {
    if (!this._enabled) return;
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  toggle(enabled: boolean): void {
    this._enabled = enabled;
    if (enabled) {
      this.scheduleNext();
    } else {
      this.stop();
      this._nextWake = 0;
    }
  }

  async triggerNow(): Promise<void> {
    await this.tick();
  }

  private scheduleNext(): void {
    this.stop();
    this._nextWake = Date.now() + this._intervalMs;
    eventBus.emit('heartbeat:sleep', { nextWake: this._nextWake });
    this.timer = setTimeout(() => this.tick(), this._intervalMs);
  }

  private async tick(): Promise<void> {
    if (this.agent.isRunning()) {
      this.scheduleNext();
      return;
    }

    eventBus.emit('heartbeat:wake', { timestamp: Date.now() });
    appendActivity({ type: 'heartbeat:wake' });

    const orders = readMemory('HEARTBEAT');
    const memory = readMemory('MEMORY');

    const prompt = [
      `Current time: ${new Date().toISOString()}`,
      '',
      '## Standing Orders',
      orders,
      '',
      '## Your Memory',
      memory,
      '',
      'Review your standing orders. If any require action right now, do it using your tools.',
      'If nothing needs doing, respond with exactly: IDLE',
    ].join('\n');

    try {
      const result = await this.agent.run(prompt, `heartbeat-${Date.now()}`);
      const decision = result.trim().startsWith('IDLE') ? 'idle' : 'acted';

      this._lastState = {
        lastRun: Date.now(),
        decision,
        summary: result.slice(0, 500),
        nextRun: Date.now() + this._intervalMs,
      };

      eventBus.emit('heartbeat:decision', { action: decision, reason: result.slice(0, 200) });
      appendActivity({ type: 'heartbeat:decision', decision, summary: result.slice(0, 200) });

      // Persist state
      const config = getConfig();
      const statePath = resolve(config.memory.stateDir, 'heartbeat.json');
      mkdirSync(resolve(config.memory.stateDir), { recursive: true });
      writeFileSync(statePath, JSON.stringify(this._lastState, null, 2), 'utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      eventBus.emit('agent:error', { conversationId: 'heartbeat', error: msg });
    }

    if (this._enabled) {
      this.scheduleNext();
    }
  }
}
