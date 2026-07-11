import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function createHarness(mode: CommandContext["mode"] = "tui") {
  const commands = new Map<string, CommandHandler>();
  const context: CommandContext = {
    mode,
    cwd: "/project",
    ui: {
      notify: vi.fn(),
      setWidget: vi.fn(),
    },
  };

  svgPreviewExtension({
    on: vi.fn(),
    registerCommand: (name: string, command: { handler: CommandHandler }) => {
      commands.set(name, command.handler);
    },
  } as unknown as ExtensionAPI);

  return {
    context,
    async run(commandLine: string) {
      const [name, ...args] = commandLine.trim().split(/\s+/);
      const handler = commands.get(name.replace(/^\//, ""));
      if (!handler) throw new Error(`Unknown command: ${name}`);
      await handler(args.join(" "), context);
    },
  };
}

describe("SVG preview commands", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
