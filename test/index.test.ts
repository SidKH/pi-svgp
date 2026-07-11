import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<void>>(),
  watchers: [] as Array<{
    close: ReturnType<typeof vi.fn>;
    emitChange(filename?: string): void;
  }>,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: vi.fn(
      (
        _path: string,
        _options: unknown,
        listener: (event: string, filename?: string) => void,
      ) => {
        const watcher = {
          close: vi.fn(),
          emitChange: (filename?: string) => listener("change", filename),
          on: vi.fn().mockReturnThis(),
        };
        fakes.watchers.push(watcher);
        return watcher;
      },
    ),
  };
});

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, copyToClipboard: fakes.copyToClipboard };
});

vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-tui")>();
  return {
    ...actual,
    Image: class {
      constructor(
        _data: string,
        _mimeType: string,
        _fallback: unknown,
        private readonly options: { filename: string; imageId?: string },
      ) {}
      getImageId() {
        return this.options.imageId ?? "test-image";
      }
      invalidate() {}
      render() {
        return [`[image: ${this.options.filename}]`];
      }
    },
  };
});

import svgPreviewExtension from "../index";

type NotificationType = "info" | "warning" | "error";
type CommandHandler = (args: string, context: CommandContext) => Promise<void>;

interface CommandContext {
  mode: "tui" | "rpc" | "json" | "print";
  cwd: string;
  ui: {
    notify: ReturnType<typeof vi.fn<(message: string, type?: NotificationType) => void>>;
    setWidget: ReturnType<typeof vi.fn>;
  };
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
const tempDirectories: string[] = [];

function createHarness(mode: CommandContext["mode"] = "tui", cwd = "/project") {
  const commands = new Map<string, CommandHandler>();
  const eventHandlers = new Map<string, () => void>();
  let widget: { render(width: number): string[] } | undefined;
  const context: CommandContext = {
    mode,
    cwd,
    ui: {
      notify: vi.fn(),
      setWidget: vi.fn((_id, factory) => {
        if (typeof factory === "function") {
          const identity = (_color: string, text: string) => text;
          widget = factory(
            { requestRender: vi.fn() },
            { fg: identity, bold: (text: string) => text },
          );
        } else {
          widget = undefined;
        }
      }),
    },
  };

  svgPreviewExtension({
    on: (event: string, handler: () => void) => eventHandlers.set(event, handler),
    registerCommand: (name: string, command: { handler: CommandHandler }) => {
      commands.set(name, command.handler);
    },
  } as unknown as ExtensionAPI);

  return {
    context,
    get widget() {
      return widget;
    },
    async run(commandLine: string) {
      const [name, ...args] = commandLine.trim().split(/\s+/);
      const handler = commands.get(name.replace(/^\//, ""));
      if (!handler) throw new Error(`Unknown command: ${name}`);
      await handler(args.join(" "), context);
    },
    shutdown() {
      eventHandlers.get("session_shutdown")?.();
    },
  };
}

async function createTempProject() {
  const directory = await mkdtemp(join(tmpdir(), "pi-svgp-test-"));
  tempDirectories.push(directory);
  return directory;
}

describe("SVG preview commands", () => {
  beforeEach(() => {
    fakes.copyToClipboard.mockReset();
    fakes.copyToClipboard.mockResolvedValue();
    fakes.watchers.length = 0;
  });

  afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true })));
  });

  it("explains that previews require an interactive terminal", async () => {
    const app = createHarness("print");
    await app.run("/svgp diagram.svg");
    expect(app.context.ui.notify).toHaveBeenCalledWith(
      "/svgp is only available in TUI mode",
      "warning",
    );
    expect(app.context.ui.setWidget).not.toHaveBeenCalled();
  });

  it("shows usage instead of opening a preview when no path is given", async () => {
    const app = createHarness();
    await app.run("/svgp");
    expect(app.context.ui.notify).toHaveBeenCalledWith(
      "Usage: /svgp path/to/file.svg",
      "warning",
    );
    expect(app.context.ui.setWidget).not.toHaveBeenCalled();
  });

  it("tells the user when there is no SVG available to copy", async () => {
    const app = createHarness();
    await app.run("/svgp-copy");
    expect(app.context.ui.notify).toHaveBeenCalledWith(
      "No live SVG preview is open",
      "warning",
    );
  });

  it("removes the preview widget when closed", async () => {
    const app = createHarness();
    await app.run("/svgp-close");
    expect(app.context.ui.setWidget).toHaveBeenCalledWith("svgp", undefined);
  });

  it("copies the exact source of the open SVG", async () => {
    const cwd = await createTempProject();
    const source = `${SVG}\n<!-- preserve this formatting -->\n`;
    await writeFile(join(cwd, "diagram.svg"), source);
    const app = createHarness("tui", cwd);

    await app.run("/svgp diagram.svg");
    await app.run("/svgp-copy");

    expect(fakes.copyToClipboard).toHaveBeenCalledWith(source);
    expect(app.context.ui.notify).toHaveBeenLastCalledWith(
      "Copied SVG: diagram.svg",
      "info",
    );
  });

  it("uses the newest preview after another SVG is opened", async () => {
    const cwd = await createTempProject();
    await writeFile(join(cwd, "first.svg"), SVG);
    const secondSource = SVG.replace("10\"><rect", "20\"><rect");
    await writeFile(join(cwd, "second.svg"), secondSource);
    const app = createHarness("tui", cwd);

    await app.run("/svgp first.svg");
    const firstWatcher = fakes.watchers[0];
    await app.run("/svgp second.svg");
    await app.run("/svgp-copy");

    expect(firstWatcher.close).toHaveBeenCalledOnce();
    expect(fakes.copyToClipboard).toHaveBeenCalledWith(secondSource);
  });

  it("recovers when an invalid SVG is corrected", async () => {
    const cwd = await createTempProject();
    const path = join(cwd, "diagram.svg");
    await writeFile(path, "not an svg");
    const app = createHarness("tui", cwd);

    await app.run("/svgp diagram.svg");
    await vi.waitFor(() => {
      expect(app.widget?.render(80).join("\n")).toContain("Error:");
    });

    await writeFile(path, SVG);
    fakes.watchers[0].emitChange("diagram.svg");

    await vi.waitFor(() => {
      const output = app.widget?.render(80).join("\n") ?? "";
      expect(output).toContain("[image: diagram.svg]");
      expect(output).not.toContain("Error:");
    });
  });

  it("stops watching the SVG when the session shuts down", async () => {
    const cwd = await createTempProject();
    await writeFile(join(cwd, "diagram.svg"), SVG);
    const app = createHarness("tui", cwd);
    await app.run("/svgp diagram.svg");

    app.shutdown();

    expect(fakes.watchers[0].close).toHaveBeenCalledOnce();
  });
});
