import type { ResearchProgress } from './deep-research.js';

export class OutputManager {
  private progressLines = 4;
  private progressArea: string[] = [];
  private initialized = false;
  private lastLogMessage = ''; // Store the last log message
  
  constructor() {
    // Initialize terminal
    if (process.stdout.isTTY) {
      process.stdout.write('\n'.repeat(this.progressLines));
      this.initialized = true;
    } else {
      this.initialized = false;
      console.warn('Not running in a TTY environment. Progress updates will be disabled.');
    }
  }
  
  log(...args: any[]) {
    if (!this.initialized) {
      console.log(...args);
      return;
    }

    // Save cursor position
    process.stdout.write('\x1b[s');

    // Move cursor up to progress area
    process.stdout.write(`\x1B[${this.progressLines}A`);
    // Clear progress area
    process.stdout.write('\x1B[0J');

    // Print log message
    this.lastLogMessage = args.join(' '); // Store the log message
    console.log(...args);

    // Restore cursor position
    process.stdout.write('\x1b[u');

    // Redraw progress area if initialized
    this.drawProgress();
  }
  
  updateProgress(progress: ResearchProgress) {
    if (!this.initialized) return;

    this.progressArea = [
      `Depth:    [${this.getProgressBar(progress.totalDepth - progress.currentDepth, progress.totalDepth)}] ${Math.round((progress.totalDepth - progress.currentDepth) / progress.totalDepth * 100)}%`,
      `Breadth:  [${this.getProgressBar(progress.totalBreadth - progress.currentBreadth, progress.totalBreadth)}] ${Math.round((progress.totalBreadth - progress.currentBreadth) / progress.totalBreadth * 100)}%`,
      `Queries:  [${this.getProgressBar(progress.completedQueries, progress.totalQueries)}] ${Math.round(progress.completedQueries / progress.totalQueries * 100)}%`,
      progress.currentQuery ? `Current:  ${progress.currentQuery}` : ''
    ];
    this.drawProgress();
  }
  
  private getProgressBar(value: number, total: number): string {
    const width = process.stdout.columns ? Math.min(30, process.stdout.columns - 20) : 30;
    const filled = Math.round((width * value) / total);
    return '█'.repeat(filled) + ' '.repeat(width - filled);
  }
  
  private drawProgress() {
    if (!this.initialized || this.progressArea.length === 0) return;
    
    // Save cursor position
    process.stdout.write('\x1b[s');

    // Move cursor to the beginning of the progress area
    const terminalHeight = process.stdout.rows || 24;
    process.stdout.write(`\x1B[${terminalHeight - this.progressLines};1H`);

    // Clear the progress area
    for (let i = 0; i < this.progressLines; i++) {
      process.stdout.write('\x1B[2K\r'); // Clear the entire line
      if (i < this.progressLines - 1) {
        process.stdout.write('\x1B[1B'); // Move to the next line
      }
    }

    // Move cursor back to the beginning of the progress area
    process.stdout.write(`\x1B[${terminalHeight - this.progressLines};1H`);

    // Draw progress bars
    process.stdout.write(this.progressArea.join('\n'));

    // Restore cursor position
    process.stdout.write('\x1b[u');
  }
}
