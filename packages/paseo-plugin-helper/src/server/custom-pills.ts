import fs from "node:fs";
import path from "node:path";
import { parseJsonc } from "./jsonc.js";
import { safeExec } from "./process.js";
import {
  CustomPillDefinitionSchema,
  type CustomPillDefinition,
  type CustomPillState,
  resolveCustomPillStatus,
  parseNumericPillValue,
  formatPillDisplay,
} from "../shared/custom-pills.js";
import type { PluginLogger } from "./logger.js";

/**
 * Discovers and validates all custom pill configuration files (.json / .jsonc)
 * from a directory (e.g. ~/.paseo/top/pills or ~/.paseo/custom-pills).
 */
export async function discoverCustomPillConfigs(
  dirPath: string,
  logger?: PluginLogger,
): Promise<CustomPillDefinition[]> {
  try {
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const configs: CustomPillDefinition[] = [];

    for (const entry of entries) {
      if (
        !entry.isFile() ||
        (!entry.name.endsWith(".json") && !entry.name.endsWith(".jsonc"))
      ) {
        continue;
      }

      const filePath = path.join(dirPath, entry.name);
      try {
        const rawContent = await fs.promises.readFile(filePath, "utf-8");
        const parsed = parseJsonc(rawContent);

        const result = CustomPillDefinitionSchema.safeParse(parsed);
        if (result.success) {
          configs.push({ ...result.data, sourceFile: filePath });
        } else {
          logger?.warn(
            `Invalid custom pill config in ${entry.name}: ${result.error.issues.map((i) => i.message).join(", ")}`,
          );
        }
      } catch (err) {
        logger?.warn(
          `Failed to read custom pill config from ${entry.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return configs;
  } catch (err) {
    logger?.warn(
      `Error reading custom pills directory ${dirPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

export interface CustomPillPollerOptions {
  /**
   * Initial list of custom pill definitions.
   */
  pills?: CustomPillDefinition[];

  /**
   * Optional directory to discover .json / .jsonc configs from.
   */
  configDir?: string;

  /**
   * Custom environment variables passed to all executed commands
   * (e.g. PASEO_AGENT_ID, PASEO_WORKSPACE_ID).
   */
  env?: Record<string, string>;

  /**
   * Working directory for executed commands. Defaults to process.cwd().
   */
  cwd?: string;

  /**
   * Optional structured logger.
   */
  logger?: PluginLogger;

  /**
   * Callback fired whenever any custom pill state changes.
   */
  onUpdate?: (states: CustomPillState[]) => void;
}

/**
 * Managed server poller for user-defined declarative custom metric pills.
 * Periodically executes shell commands, computes statuses via thresholds,
 * and maintains reactive live state.
 */
export class CustomPillPoller {
  private pills = new Map<string, CustomPillDefinition>();
  private states = new Map<string, CustomPillState>();
  private timers = new Map<string, NodeJS.Timeout>();
  private inFlight = new Set<string>();
  private running = false;
  private options: CustomPillPollerOptions;

  constructor(options: CustomPillPollerOptions = {}) {
    this.options = options;
    if (options.pills) {
      for (const pill of options.pills) {
        this.pills.set(pill.id, pill);
      }
    }
  }

  /**
   * Starts the polling loops for all configured custom pills.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (this.options.configDir) {
      const discovered = await discoverCustomPillConfigs(
        this.options.configDir,
        this.options.logger,
      );
      for (const pill of discovered) {
        this.pills.set(pill.id, pill);
      }
    }

    for (const pill of this.pills.values()) {
      if (pill.enabled) {
        this.schedulePill(pill, 0);
      }
    }
  }

  /**
   * Manually triggers an immediate execution of a single custom pill.
   */
  async pollPill(pillId: string): Promise<CustomPillState | undefined> {
    const pill = this.pills.get(pillId);
    if (!pill) return undefined;
    if (this.inFlight.has(pillId)) {
      return this.states.get(pillId);
    }

    this.inFlight.add(pillId);
    try {
      const result = await safeExec(pill.command, {
        timeoutMs: pill.timeoutMs,
        env: { ...process.env, ...this.options.env },
        cwd: this.options.cwd,
      });

      const rawValue = result.stdout || result.stderr || "";
      const numericValue = parseNumericPillValue(rawValue);
      const status = resolveCustomPillStatus(numericValue, pill.thresholds);
      const displayValue = formatPillDisplay(rawValue, pill.prefix, pill.suffix);

      const state: CustomPillState = {
        id: pill.id,
        title: pill.title,
        compactTitle: pill.compactTitle,
        icon: pill.icon,
        compactIcon: pill.compactIcon,
        rawValue,
        displayValue,
        numericValue,
        status,
        lastUpdated: Date.now(),
        sourceFile: pill.sourceFile,
        modalTitle: pill.modal?.title ?? pill.title,
        modalDescription: pill.modal?.description,
      };

      this.states.set(pill.id, state);
      this.notifyUpdate();
      return state;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.options.logger?.warn(`Custom pill '${pill.id}' execution failed: ${errorMsg}`);

      const previous = this.states.get(pill.id);
      const state: CustomPillState = {
        id: pill.id,
        title: pill.title,
        compactTitle: pill.compactTitle,
        icon: pill.icon,
        compactIcon: pill.compactIcon,
        rawValue: previous?.rawValue ?? "ERR",
        displayValue: previous?.displayValue ?? "ERR",
        status: "danger",
        lastUpdated: Date.now(),
        error: errorMsg,
        sourceFile: pill.sourceFile,
        modalTitle: pill.modal?.title ?? pill.title,
        modalDescription: pill.modal?.description,
      };

      this.states.set(pill.id, state);
      this.notifyUpdate();
      return state;
    } finally {
      this.inFlight.delete(pillId);
    }
  }

  /**
   * Executes the on-demand drilldown command configured in pill.modal.command.
   */
  async runModalCommand(
    pillId: string,
  ): Promise<{ output?: string; error?: string }> {
    const pill = this.pills.get(pillId);
    if (!pill) {
      return { error: `Custom pill '${pillId}' not found` };
    }

    const commandToRun = pill.modal?.command ?? pill.command;
    try {
      const result = await safeExec(commandToRun, {
        timeoutMs: pill.timeoutMs,
        env: { ...process.env, ...this.options.env },
        cwd: this.options.cwd,
      });

      const output = result.stdout || result.stderr || "No output";
      const existing = this.states.get(pillId);
      if (existing) {
        existing.modalOutput = output;
        existing.modalLastUpdated = Date.now();
        delete existing.modalError;
        this.notifyUpdate();
      }

      return { output };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const existing = this.states.get(pillId);
      if (existing) {
        existing.modalError = errorMsg;
        this.notifyUpdate();
      }
      return { error: errorMsg };
    }
  }

  /**
   * Updates or reconciles the list of pill definitions dynamically.
   */
  updatePills(newPills: CustomPillDefinition[]): void {
    const nextIds = new Set(newPills.map((p) => p.id));

    // Remove obsolete pills
    for (const [id, timer] of this.timers.entries()) {
      if (!nextIds.has(id)) {
        clearTimeout(timer);
        this.timers.delete(id);
        this.pills.delete(id);
        this.states.delete(id);
      }
    }

    // Add or update pills
    for (const pill of newPills) {
      this.pills.set(pill.id, pill);
      const currentTimer = this.timers.get(pill.id);
      if (currentTimer) {
        clearTimeout(currentTimer);
        this.timers.delete(pill.id);
      }

      if (this.running && pill.enabled) {
        this.schedulePill(pill, 0);
      }
    }

    this.notifyUpdate();
  }

  /**
   * Returns live state for a single custom pill.
   */
  getState(pillId: string): CustomPillState | undefined {
    return this.states.get(pillId);
  }

  /**
   * Returns live states for all custom pills.
   */
  getAllStates(): CustomPillState[] {
    return Array.from(this.states.values());
  }

  /**
   * Stops all active polling loops and clears resources.
   */
  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.inFlight.clear();
  }

  private schedulePill(pill: CustomPillDefinition, delayMs: number): void {
    if (!this.running) return;

    const timer = setTimeout(async () => {
      await this.pollPill(pill.id);
      if (this.running && this.pills.has(pill.id)) {
        const nextPill = this.pills.get(pill.id);
        if (nextPill?.enabled) {
          this.schedulePill(nextPill, nextPill.intervalMs);
        }
      }
    }, delayMs);

    this.timers.set(pill.id, timer);
  }

  private notifyUpdate(): void {
    if (this.options.onUpdate) {
      try {
        this.options.onUpdate(this.getAllStates());
      } catch {
        // Prevent callback errors from disrupting poller
      }
    }
  }
}
