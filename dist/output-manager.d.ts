import type { ResearchProgress } from './deep-research.js';
export declare class OutputManager {
    private progressLines;
    private progressArea;
    private initialized;
    constructor();
    log(...args: any[]): void;
    updateProgress(progress: ResearchProgress): void;
    private getProgressBar;
    private drawProgress;
}
//# sourceMappingURL=output-manager.d.ts.map