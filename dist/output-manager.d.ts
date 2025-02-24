import type { ResearchProgress } from './deep-research.js';
export declare class OutputManager {
    private progressLines;
    private progressArea;
    private initialized;
    private lastLogMessage;
    private logQueue;
    private logTimer?;
    constructor();
    private formatLogEntry;
    log(message: string, metadata?: Record<string, unknown>): void;
    private enqueueLog;
    private scheduleFlush;
    private flushLogs;
    static logCacheEviction(value: unknown): void;
    updateProgress(progress: ResearchProgress): void;
    private getProgressBar;
    private drawProgress;
    saveResearchReport(reportContent: string): void;
}
//# sourceMappingURL=output-manager.d.ts.map