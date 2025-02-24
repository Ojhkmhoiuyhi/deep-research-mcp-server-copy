import { writeFileSync } from 'fs';
import { TERMINAL_CONTROLS } from './terminal-utils.js';
export class OutputManager {
    progressLines = 4;
    progressArea = [];
    initialized = false;
    lastLogMessage = ''; // Store the last log message
    logQueue = [];
    logTimer;
    constructor() {
        // Initialize terminal
        if (process.stdout.isTTY) {
            process.stdout.write('\n'.repeat(this.progressLines));
            this.initialized = true;
        }
        else {
            this.initialized = false;
            console.warn('Not running in a TTY environment. Progress updates will be disabled.');
        }
    }
    formatLogEntry(message, metadata) {
        const timestamp = new Date().toISOString();
        const metaStr = metadata ? JSON.stringify(metadata) : '';
        return `[${timestamp}] ${message} ${metaStr}`;
    }
    log(message, metadata) {
        this.enqueueLog(this.formatLogEntry(message, metadata));
        this.scheduleFlush();
    }
    enqueueLog(entry) {
        this.logQueue.push(entry);
        if (this.logQueue.length > 100) {
            this.flushLogs(); // Prevent memory leaks
        }
    }
    scheduleFlush() {
        if (!this.logTimer) {
            this.logTimer = setTimeout(() => this.flushLogs(), 50);
        }
    }
    flushLogs() {
        try {
            process.stdout.write(TERMINAL_CONTROLS.savePos);
            process.stdout.write(this.logQueue.join('\n') + '\n');
            this.logQueue = [];
        }
        finally {
            if (this.logTimer)
                clearTimeout(this.logTimer);
            process.stdout.write(TERMINAL_CONTROLS.restorePos);
        }
    }
    static logCacheEviction(value) {
        console.log(`Cache evicted: ${JSON.stringify(value)}`);
    }
    updateProgress(progress) {
        if (!this.initialized)
            return;
        this.progressArea = [
            `Depth:    [${this.getProgressBar(progress.totalDepth - progress.currentDepth, progress.totalDepth)}] ${Math.round((progress.totalDepth - progress.currentDepth) / progress.totalDepth * 100)}%`,
            `Breadth:  [${this.getProgressBar(progress.totalBreadth - progress.currentBreadth, progress.totalBreadth)}] ${Math.round((progress.totalBreadth - progress.currentBreadth) / progress.totalBreadth * 100)}%`,
            `Queries:  [${this.getProgressBar(progress.completedQueries, progress.totalQueries)}] ${Math.round(progress.completedQueries / progress.totalQueries * 100)}%`,
            progress.currentQuery ? `Current:  ${progress.currentQuery}` : ''
        ];
        this.drawProgress();
    }
    getProgressBar(value, total) {
        const width = process.stdout.columns ? Math.min(30, process.stdout.columns - 20) : 30;
        const filled = Math.round((width * value) / total);
        return '█'.repeat(filled) + ' '.repeat(width - filled);
    }
    drawProgress() {
        if (!this.initialized || this.progressArea.length === 0)
            return;
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
    saveResearchReport(reportContent) {
        const filename = 'output.md';
        try {
            writeFileSync(filename, reportContent);
            this.log(`Final report saved to ${filename}`);
        }
        catch (error) {
            this.log(`Error saving report to ${filename}:`, { error: error instanceof Error ? error.message : String(error) });
        }
    }
}
