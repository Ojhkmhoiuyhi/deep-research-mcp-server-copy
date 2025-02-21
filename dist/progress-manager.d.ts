import type { ResearchProgress } from './deep-research.js';
export declare class ProgressManager {
    private lastProgress;
    private numberOfProgressLines;
    private initialized;
    private terminalHeight;
    constructor(numberOfProgressLines?: number);
    /**
     * Draws a single progress bar string.
     *
     * @param label - The label for the progress bar (e.g., 'Depth:').
     * @param value - The current progress value.
     * @param total - The total value for 100% progress.
     * @param char - The character to use for the filled part of the bar.
     * @returns The formatted progress bar string.
     */
    private drawProgressBar;
    /**
     * Updates the progress display in the terminal.
     *
     * @param progress - An object containing the current research progress.
     */
    updateProgress(progress: ResearchProgress): void;
    /**
     * Stops the progress display and moves the cursor below the progress area.
     */
    stop(): void;
}
//# sourceMappingURL=progress-manager.d.ts.map