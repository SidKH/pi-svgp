import {
  copyToClipboard,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Image, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

interface LiveSvgPreviewOptions {
  displayPath: string;
  absolutePath: string;
  maxWidthCells: number;
  maxHeightCells: number;
  theme: Theme;
  requestRender: () => void;
  notify: (message: string, type?: "info" | "warning" | "error") => void;
}

class LiveSvgPreview implements Component {
  private readonly displayPath: string;
  private readonly absolutePath: string;
  private readonly maxWidthCells: number;
  private readonly maxHeightCells: number;
  private readonly theme: Theme;
  private readonly requestRender: () => void;
  private readonly notify: LiveSvgPreviewOptions["notify"];

  private error?: string;
  private image?: Image;
  private watcher?: FSWatcher;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private refreshController?: AbortController;
  private disposed = false;
  private status = "loading";

  constructor(options: LiveSvgPreviewOptions) {
    this.displayPath = options.displayPath;
    this.absolutePath = options.absolutePath;
    this.maxWidthCells = options.maxWidthCells;
    this.maxHeightCells = options.maxHeightCells;
    this.theme = options.theme;
    this.requestRender = options.requestRender;
    this.notify = options.notify;
  }

  start() {
    void this.refresh();
    try {
      const dir = dirname(this.absolutePath);
      const file = basename(this.absolutePath);
      this.watcher = watch(
        dir,
        { persistent: false },
        (_eventType, filename) => {
          if (!filename || filename.toString() === file) this.scheduleRefresh();
        },
      );
      this.watcher.on("error", (error) => this.handleWatchError(error));
    } catch (error) {
      this.handleWatchError(error);
    }
  }

  dispose() {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.refreshController?.abort();
    this.watcher?.close();
  }

  invalidate() {
    this.image?.invalidate();
  }

  render(width: number): string[] {
    const title = this.theme.fg(
      "accent",
      this.theme.bold(`svgp: ${this.displayPath}`),
    );
    const help = this.theme.fg("dim", "/svgp-copy • /svgp-close");
    const lines = [
      truncateToWidth(title, width),
      truncateToWidth(this.theme.fg("muted", this.status), width),
    ];

    if (this.error) {
      lines.push(
        truncateToWidth(this.theme.fg("error", `Error: ${this.error}`), width),
      );
    } else if (this.image) {
      lines.push("");
      lines.push(...this.image.render(width));
      lines.push("");
    }

    lines.push(truncateToWidth(help, width));
    if (!this.error && this.image) lines.push("");
    return lines;
  }

  private handleWatchError(error: unknown) {
    if (this.disposed) return;
    this.error = `watch failed: ${getErrorMessage(error)}`;
    this.status = "watch failed";
    this.watcher?.close();
    this.watcher = undefined;
    this.requestRender();
  }

  private scheduleRefresh() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.refresh(), 100);
  }

  async refresh() {
    this.refreshController?.abort();
    const controller = new AbortController();
    this.refreshController = controller;

    try {
      this.status = "Rendering…";
      this.requestRender();
      const svg = await readFile(this.absolutePath, {
        signal: controller.signal,
      });

      const resvg = new Resvg(svg, {
        fitTo: { mode: "width", value: Math.max(1, this.maxWidthCells * 12) },
      });
      const pngBase64 = Buffer.from(resvg.render().asPng()).toString("base64");
      const imageId = this.image?.getImageId();
      this.image = new Image(pngBase64, "image/png", this.theme, {
        maxWidthCells: this.maxWidthCells,
        maxHeightCells: this.maxHeightCells,
        filename: this.displayPath,
        imageId,
      });
      this.error = undefined;
      this.status = `updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      if (controller.signal.aborted) return;
      this.error = getErrorMessage(error);
      this.status = "render failed";
    } finally {
      if (this.refreshController === controller) {
        this.refreshController = undefined;
        if (!this.disposed) this.requestRender();
      }
    }
  }

  async copySvg() {
    try {
      await copyToClipboard(await readFile(this.absolutePath, "utf8"));
      this.notify(`Copied SVG: ${this.displayPath}`, "info");
    } catch (error) {
      this.notify(`Failed to copy SVG: ${getErrorMessage(error)}`, "error");
    }
  }
}

export default function (pi: ExtensionAPI) {
  let currentPreview: LiveSvgPreview | undefined;

  function disposeCurrentPreview() {
    currentPreview?.dispose();
    currentPreview = undefined;
  }

  pi.on("session_shutdown", disposeCurrentPreview);

  pi.registerCommand("svgp", {
    description: "Show a live SVG preview widget",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/svgp is only available in TUI mode", "warning");
        return;
      }

      const inputPath = args.trim();
      if (!inputPath) {
        ctx.ui.notify("Usage: /svgp path/to/file.svg", "warning");
        return;
      }

      const absolutePath = resolve(ctx.cwd, inputPath);
      disposeCurrentPreview();
      ctx.ui.setWidget(
        "svgp",
        (tui, theme) => {
          const panel = new LiveSvgPreview({
            displayPath: inputPath,
            absolutePath,
            maxWidthCells: 80,
            maxHeightCells: 10,
            theme,
            requestRender: () => tui.requestRender(),
            notify: (message, type) => ctx.ui.notify(message, type),
          });
          currentPreview = panel;
          panel.start();
          return panel;
        },
        { placement: "belowEditor" },
      );
      ctx.ui.notify(`Showing live SVG preview: ${inputPath}`, "info");
    },
  });

  pi.registerCommand("svgp-close", {
    description: "Close the live SVG preview widget",
    handler: async (_args, ctx) => {
      disposeCurrentPreview();
      ctx.ui.setWidget("svgp", undefined);
    },
  });

  pi.registerCommand("svgp-copy", {
    description: "Copy the SVG source from the live preview",
    handler: async (_args, ctx) => {
      if (!currentPreview) {
        ctx.ui.notify("No live SVG preview is open", "warning");
        return;
      }
      await currentPreview.copySvg();
    },
  });
}
