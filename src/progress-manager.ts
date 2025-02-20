import type { ResearchProgress } from './deep-research.js';

// Constants for ANSI escape codes to improve readability
const ESC = '\x1B[';
const CLEAR_LINE = `${ESC}0J`; // Clear line from cursor to end
const CURSOR_TO_LINE = (line: number) => `${ESC}${line};1H`; // Move cursor to specified line and column 1
const CURSOR_UP = (lines: number) => `${ESC}${lines}A`; // Move cursor up by specified lines
const CURSOR_DOWN = (lines: number) => `${ESC}${lines}B`; // Move cursor down by specified lines

const NUMBER_OF_PROGRESS_LINES = 4; // Constant for the number of progress lines

export class ProgressManager {
  private lastProgress: ResearchProgress | undefined;
  private numberOfProgressLines = NUMBER_OF_PROGRESS_LINES;
  private initialized = false;

  constructor() {
    // Initialize terminal with empty lines for progress display
    process.stdout.write('\n'.repeat(this.numberOfProgressLines));
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
    // Store progress for potential redraw or access
    this.lastProgress = progress;

    // Determine the starting line for progress bars to position them at the bottom of the terminal
    const terminalHeight = process.stdout.rows || 24;
    const progressStartLine = terminalHeight - this.numberOfProgressLines;

    // Move cursor to the start of the progress area and clear lines
    process.stdout.write(`${CURSOR_TO_LINE(progressStartLine)}${CLEAR_LINE}`); // Move cursor to line and clear

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

    // Output all progress lines, joined by newlines, to the terminal
    process.stdout.write(`${lines.join('\n')}\n`);

    // Move the cursor up to the beginning of the progress display area
    process.stdout.write(CURSOR_UP(this.numberOfProgressLines)); // Move cursor back up
  }

  /**
   * Stops the progress display and moves the cursor below the progress area.
   */
  stop(): void { // Added return type void
    // Move cursor down past the progress area, ensuring subsequent output is below the progress bars
    process.stdout.write(`${CURSOR_DOWN(this.numberOfProgressLines)}\n`); // Move cursor down
  }
}
