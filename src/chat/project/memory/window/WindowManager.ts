// window/WindowManager.ts

import type {
  AddTurnToWindowResult,
  BoundaryDecision,
  CloseOpenWindowResult,
  EpisodeWindowInput,
  MemoryWindow,
  Turn,
  WindowBoundaryReason,
  WindowManagerConfig,
} from "./types";
import { cloneWindow } from "./helpers";
import {
  assertValidConfig,
  assertValidTurn,
} from "./validation";
import {
  deleteAllWindows,
  findOpenWindowIndex,
  loadAllWindows,
  saveWindow,
} from "./windowStorage";
import {
  appendTurn,
  closeWindow,
  createEpisodeInput,
  createWindow,
} from "./windowLifecycle";
import { detectBoundary } from "./boundaryDetection";
import { getLimitBoundaryReason } from "./windowLimits";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_CONFIG: WindowManagerConfig = {
  maximumTurns: 8,
  maximumTokens: 6000,
  fallbackSimilarityThreshold: 0.42,
  recentTurnsForBoundary: 3,
};

/* -------------------------------------------------------------------------- */
/* WindowManager                                                              */
/* -------------------------------------------------------------------------- */

export class WindowManager {
  private readonly config: WindowManagerConfig;

  /**
   * Prevents concurrent operations from changing the same open Window.
   */
  private operationQueue: Promise<void> =
    Promise.resolve();

  public constructor(
    config: Partial<WindowManagerConfig> = {},
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    assertValidConfig(this.config);
  }

  /**
   * Adds a Turn to the current Window.
   *
   * The affected Windows are persisted in the SQLite database. When the
   * previous Window is closed, episodeInput contains a stable, closed
   * Window that can be passed directly to EpisodeManager.
   */
  public async addTurn(
    turn: Turn,
  ): Promise<AddTurnToWindowResult> {
    assertValidTurn(turn);

    return this.runExclusive(async () => {
      const windows =
        await loadAllWindows();

      const openWindowIndex =
        findOpenWindowIndex(windows);

      if (openWindowIndex === -1) {
        const newWindow =
        await this.createPossiblyOversizedWindow(
          turn,
        );

        await saveWindow(newWindow);

        const result: AddTurnToWindowResult = {
          action: "created",
          windowId: newWindow.id,
          window: cloneWindow(newWindow),
        };

        /*
         * An oversized Turn immediately creates a closed Window.
         * Therefore it is already ready for EpisodeManager.
         */
        if (newWindow.status === "closed") {
          result.closedWindow =
            cloneWindow(newWindow);

          result.episodeInput =
            createEpisodeInput(newWindow);
        }

        return result;
      }

      const currentWindow =
        windows[openWindowIndex];

      if (!currentWindow) {
        throw new Error(
          "The open Window could not be found.",
        );
      }

      const limitBoundaryReason =
        getLimitBoundaryReason(
          currentWindow,
          turn,
          this.config,
        );

      if (limitBoundaryReason) {
        return this.closeCurrentAndCreateNew(
          currentWindow,
          turn,
          limitBoundaryReason,
        );
      }

      const boundaryDecision =
        await detectBoundary(
          currentWindow,
          turn,
          this.config,
        );

      if (
        boundaryDecision.decision ===
        "boundary"
      ) {
        return this.closeCurrentAndCreateNew(
          currentWindow,
          turn,
          "llm_boundary",
          boundaryDecision,
        );
      }

      const updatedWindow =
        await appendTurn(
          currentWindow,
          turn,
        );

      await saveWindow(updatedWindow);

      return {
        action: "appended",
        windowId: updatedWindow.id,
        window: cloneWindow(updatedWindow),
        boundaryDecision,
      };
    });
  }

  /**
   * Returns copies of all persisted Windows.
   */
  public async getAllWindows(): Promise<
    MemoryWindow[]
  > {
    return loadAllWindows();
  }

  /**
   * Returns the currently open Window.
   */
  public async getOpenWindow(): Promise<
    MemoryWindow | null
  > {
    const windows =
      await loadAllWindows();

    const openWindowIndex =
      findOpenWindowIndex(windows);

    if (openWindowIndex === -1) {
      return null;
    }

    const openWindow =
      windows[openWindowIndex];

    return openWindow
      ? cloneWindow(openWindow)
      : null;
  }

  /**
   * Returns all closed Windows.
   *
   * This is useful when EpisodeManager must rebuild its state after an
   * application restart.
   */
  public async getClosedWindows(): Promise<
    MemoryWindow[]
  > {
    return (await loadAllWindows()).filter(
      (window) =>
        window.status === "closed",
    );
  }

  /**
   * Returns every closed Window in the exact format expected by
   * EpisodeManager.
   */
  public async getEpisodeInputs(): Promise<
    EpisodeWindowInput[]
  > {
    const closedWindows =
      await this.getClosedWindows();

    return closedWindows.map(
      createEpisodeInput,
    );
  }

  /**
   * Closes the current Window manually and creates an Episode input.
   */
  public async closeOpenWindow(): Promise<
    CloseOpenWindowResult | null
  > {
    return this.runExclusive(async () => {
      const windows =
        await loadAllWindows();

      const openWindowIndex =
        findOpenWindowIndex(windows);

      if (openWindowIndex === -1) {
        return null;
      }

      const currentWindow =
        windows[openWindowIndex];

      if (!currentWindow) {
        return null;
      }

      const closedWindow =
        closeWindow(
          currentWindow,
          "manual",
        );

      await saveWindow(closedWindow);

      return {
        windowId: closedWindow.id,
        closedWindow:
          cloneWindow(closedWindow),

        episodeInput:
          createEpisodeInput(closedWindow),
      };
    });
  }

  /**
   * Removes all persisted Windows from the database.
   */
  public async clearWindows(): Promise<void> {
    await deleteAllWindows();
  }

  private async createPossiblyOversizedWindow(
    turn: Turn,
  ): Promise<MemoryWindow> {
    const newWindow =
      await createWindow(turn);

    if (
      turn.estimatedTokens >
      this.config.maximumTokens
    ) {
      return closeWindow(
        newWindow,
        "oversized_turn",
      );
    }

    return newWindow;
  }

  private async closeCurrentAndCreateNew(
    currentWindow: MemoryWindow,
    newTurn: Turn,
    reason: WindowBoundaryReason,
    boundaryDecision?: BoundaryDecision,
  ): Promise<AddTurnToWindowResult> {
    /*
     * One timestamp is used for closing the old Window and starting
     * the next Window operation.
     */
    const boundaryTime =
      new Date().toISOString();

    const closedWindow =
      closeWindow(
        currentWindow,
        reason,
        boundaryTime,
      );

    const newWindow =
      await this.createPossiblyOversizedWindow(
        newTurn,
      );

    /*
     * Both changes are persisted in two database writes:
     * 1. Previous Window becomes closed.
     * 2. New Window is inserted.
     */
    await saveWindow(closedWindow);
    await saveWindow(newWindow);

    const result: AddTurnToWindowResult = {
      action: "created",
      windowId: newWindow.id,
      window: cloneWindow(newWindow),
      closedWindow:
        cloneWindow(closedWindow),
      episodeInput:
        createEpisodeInput(closedWindow),
      boundaryDecision,
    };

    return result;
  }

  private async runExclusive<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    let releaseQueue:
      | (() => void)
      | undefined;

    const previousOperation =
      this.operationQueue;

    this.operationQueue =
      new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });

    await previousOperation;

    try {
      return await operation();
    } finally {
      releaseQueue?.();
    }
  }
}
