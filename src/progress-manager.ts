import type { ResearchProgress } from './deep-research.js';

// Constants for ANSI escape codes to improve readability
const ESC = '\x1B[';
const CLEAR_LINE = `${ESC}2K`; // Clear the entire line
const CURSOR_TO_LINE = (line: number) => `${ESC}${line};1H`; // Move cursor to specified line and column 1
const CURSOR_UP = (lines: number) => `${ESC}${lines}A`; // Move cursor up by specified lines
const CURSOR_DOWN = (lines: number) => `${ESC}${lines}B`; // Move cursor down by specified lines

const DEFAULT_NUMBER_OF_PROGRESS_LINES = 4; // Constant for the number of progress lines

export class ProgressManager {
  private lastProgress: ResearchProgress | undefined;
  private numberOfProgressLines: number;
  private initialized = false;
  private terminalHeight: number;

  constructor(numberOfProgressLines: number = DEFAULT_NUMBER_OF_PROGRESS_LINES) {
    this.numberOfProgressLines = numberOfProgressLines;
    this.terminalHeight = process.stdout.rows || 24;

    // Initialize terminal with empty lines for progress display
    try {
      process.stdout.write('\n'.repeat(this.numberOfProgressLines));
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize ProgressManager:", error);
      this.initialized = false;
    }

    // Update terminal height on resize
    process.stdout.on('resize', () => {
      this.terminalHeight = process.stdout.rows || 24;
    });
  }

  /**
   * Draws a single progress bar string.
   *
   * @param label - The label for the progress bar (e.g., 'Depth:').
   * @param value - The current progress value.
   * @param total - The total value for 100% progress.
   * @param char - The character to use for the filled part of the bar.
   * @returns The formatted progress bar string.
   */
  private drawProgressBar(
    label: string,
    value: number,
    total: number,
    char = '='
  ): string {
    const width = process.stdout.columns ? Math.min(30, process.stdout.columns - 20) : 30;
    const percent = (value / total) * 100;
    const filled = Math.round((width * percent) / 100);
    const empty = width - filled;

    return `${label} [${char.repeat(filled)}${' '.repeat(empty)}] ${Math.round(percent)}%`;
  }

  /**
   * Updates the progress display in the terminal.
   *
   * @param progress - An object containing the current research progress.
   */
  updateProgress(progress: ResearchProgress): void { // Added return type void
    if (!this.initialized) return;

    // Store progress for potential redraw or access
    this.lastProgress = progress;

    // Determine the starting line for progress bars to position them at the bottom of the terminal
    const progressStartLine = this.terminalHeight - this.numberOfProgressLines;

    // Generate progress bar lines
    const lines: string[] = [
      this.drawProgressBar(
        'Depth:   ',
        progress.totalDepth - progress.currentDepth,
        progress.totalDepth,
        '█'
      ),
      this.drawProgressBar(
        'Breadth: ',
        progress.totalBreadth - progress.currentBreadth,
        progress.totalBreadth,
        '█'
      ),
      this.drawProgressBar(
        'Queries: ',
        progress.completedQueries,
        progress.totalQueries,
        '█'
      ),
    ];

    // Add current query line if it exists in the progress data
    if (progress.currentQuery) {
      lines.push(`Current:  ${progress.currentQuery}`);
    }

    try {
      // Move cursor to the start of the progress area and clear lines
      process.stdout.write(`${CURSOR_TO_LINE(progressStartLine)}`);

      for (let i = 0; i < this.numberOfProgressLines; i++) {
        process.stdout.write(`${CLEAR_LINE}\n`);
      }

      // Move cursor back to the start of the progress area
      process.stdout.write(`${CURSOR_TO_LINE(progressStartLine)}`);

      // Output all progress lines, joined by newlines, to the terminal
      process.stdout.write(`${lines.join('\n')}\n`);
    } catch (error) {
      console.error("Failed to update progress:", error);
    }
  }

  /**
   * Stops the progress display and moves the cursor below the progress area.
   */
  stop(): void { // Added return type void
    if (!this.initialized) return;

    try {
      // Move cursor down past the progress area, ensuring subsequent output is below the progress bars
      process.stdout.write(`${CURSOR_DOWN(this.numberOfProgressLines)}\n`); // Move cursor down
    } catch (error) {
      console.error("Failed to stop ProgressManager:", error);
    }
  }
}
