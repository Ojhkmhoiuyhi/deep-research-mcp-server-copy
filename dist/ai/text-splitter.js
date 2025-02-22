import { getEncoding } from "js-tiktoken";
// Define a configuration object for model-specific settings
const modelConfig = {
    "o200k_base": { maxTokens: 8192 },
    "cl100k_base": { maxTokens: 8192 }, // Add cl100k_base config
    // Add more models and their maxTokens values here
};
class TextSplitter {
    chunkSize = 600;
    chunkOverlap = 100;
    modelName = "o200k_base";
    maxTokens; //  Remove default value
    constructor(fields) {
        this.chunkSize = fields?.chunkSize ?? this.chunkSize;
        this.chunkOverlap = fields?.chunkOverlap ?? this.chunkOverlap;
        this.modelName = fields?.modelName ?? this.modelName;
        // Look up maxTokens from modelConfig, or use a default if not found
        this.maxTokens = modelConfig[this.modelName]?.maxTokens ?? 8192; // Default to 8192 if model not in config
        if (this.chunkOverlap >= this.chunkSize) {
            throw new Error('Cannot have chunkOverlap >= chunkSize');
        }
    }
    createDocuments(texts) {
        const documents = [];
        for (let i = 0; i < texts.length; i += 1) {
            const text = texts[i];
            if (text != null) {
                for (const chunk of this.splitText(text)) {
                    documents.push(chunk);
                }
            }
        }
        return documents;
    }
    splitDocuments(documents) {
        return this.createDocuments(documents);
    }
    joinDocs(docs, separator) {
        const text = docs.join(separator).trim();
        return text === '' ? null : text;
    }
    mergeSplits(splits, separator) {
        const docs = [];
        const currentDoc = [];
        let total = 0;
        for (const d of splits) {
            const _len = d.length;
            if (total + _len >= this.chunkSize) {
                if (total > this.chunkSize) {
                    console.warn(`Created a chunk of size ${total}, +
which is longer than the specified ${this.chunkSize}`);
                }
                if (currentDoc.length > 0) {
                    const doc = this.joinDocs(currentDoc, separator);
                    if (doc !== null) {
                        docs.push(doc);
                    }
                    // Keep on popping if:
                    // - we have a larger chunk than in the chunk overlap
                    // - or if we still have any chunks and the length is long
                    while (total > this.chunkOverlap ||
                        (total + _len > this.chunkSize && total > 0)) {
                        if (currentDoc[0]) {
                            total -= currentDoc[0].length;
                        }
                        currentDoc.shift();
                    }
                }
            }
            currentDoc.push(d);
            total += _len;
        }
        const doc = this.joinDocs(currentDoc, separator);
        if (doc !== null) {
            docs.push(doc);
        }
        return docs;
    }
}
export class RecursiveCharacterTextSplitter extends TextSplitter {
    separators = ["\n\n", "\n", " ", ""];
    constructor(fields) {
        super(fields);
        this.separators = fields?.separators ?? this.separators;
    }
    splitText(text) {
        const splits = [];
        let currentText = text;
        for (const separator of this.separators) {
            const split = currentText.split(separator);
            const newSplits = [];
            for (const s of split) {
                if (s.length > this.chunkSize) {
                    // Recursively split the text
                    const recursiveSplits = this.splitText(s);
                    newSplits.push(...recursiveSplits);
                }
                else {
                    newSplits.push(s);
                }
            }
            currentText = newSplits.join(separator); // Join with the current separator for the next iteration
        }
        // Handle any remaining text that couldn't be split
        if (currentText.length > 0) {
            splits.push(currentText);
        }
        return splits;
    }
}
export class TiktokenTextSplitter extends TextSplitter {
    tokenizer;
    contextLength;
    constructor(fields) {
        super(fields);
        this.contextLength = fields?.contextLength ?? 0;
        try {
            this.tokenizer = getEncoding(this.modelName);
        }
        catch (e) {
            console.warn(`Failed to load ${this.modelName}, falling back to o200k_base`);
            this.tokenizer = getEncoding("o200k_base");
        }
    }
    splitText(text) {
        const encoded = this.tokenizer.encode(text);
        const chunks = [];
        let currentChunk = [];
        let currentChunkLength = 0;
        for (const token of encoded) {
            currentChunk.push(token);
            currentChunkLength++;
            if (currentChunkLength >= this.chunkSize) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentChunkLength = 0;
            }
        }
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }
        // Apply overlap
        const finalChunks = [];
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            let overlapStart = Math.max(0, i * (this.chunkSize - this.chunkOverlap));
            let overlapEnd = Math.min(encoded.length, (i + 1) * this.chunkSize);
            const chunkWithOverlap = encoded.slice(overlapStart, overlapEnd);
            finalChunks.push(this.tokenizer.decode(chunkWithOverlap));
        }
        return finalChunks;
    }
}
