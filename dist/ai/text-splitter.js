import { embeddingModel } from './providers.js';
// Update model configuration for Gemini embeddings
const modelConfig = {
    "text-embedding-004": { maxTokens: 3072 }, // Gemini text-embedding model
    "multimodal-embedding-001": { maxTokens: 2048 }, // Multimodal embedding
    // Default to latest Gemini embedding model
    "default": { maxTokens: 3072 }
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
    // Update mergeSplits to use async token counting
    async mergeSplits(splits, separator) {
        const docs = [];
        let currentDoc = [];
        let total = 0;
        for (const d of splits) {
            const _len = await this.getTokenCount(d);
            if (total + _len >= this.chunkSize) {
                if (currentDoc.length > 0) {
                    const doc = this.joinDocs(currentDoc, separator);
                    if (doc)
                        docs.push(doc);
                    while (total > this.chunkOverlap) {
                        if (currentDoc[0]) {
                            total -= await this.getTokenCount(currentDoc[0]);
                        }
                        currentDoc.shift();
                    }
                }
            }
            currentDoc.push(d);
            total += _len;
        }
        const finalDoc = this.joinDocs(currentDoc, separator);
        if (finalDoc)
            docs.push(finalDoc);
        return docs;
    }
    async getTokenCount(text) {
        try {
            const result = await embeddingModel.countTokens(text);
            return result.totalTokens;
        }
        catch (error) {
            console.error('Gemini token count failed, using fallback:', error);
            return text.split(/\s+/).length;
        }
    }
}
export class RecursiveCharacterTextSplitter extends TextSplitter {
    separators = ["\n\n", "\n", " ", ""];
    tokenizer = {
        encode: (text) => [], // Dummy implementation
        decode: (tokens) => ""
    };
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
    async getTokenCount(text) {
        try {
            const result = await embeddingModel.countTokens(text);
            return result.totalTokens;
        }
        catch (error) {
            console.error('Gemini token count failed, using fallback:', error);
            return text.split(/\s+/).length;
        }
    }
}
export class TiktokenTextSplitter extends TextSplitter {
    tokenizer = {
        encode: (text) => [], // Formal implementation only
        decode: (tokens) => ""
    };
    constructor(fields) {
        super(fields);
    }
    async getTokenCount(text) {
        try {
            const result = await embeddingModel.countTokens(text);
            return result.totalTokens;
        }
        catch (error) {
            console.error('Gemini token count failed, using fallback:', error);
            return text.split(/\s+/).length;
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
export class SemanticTextSplitter {
    chunkSize;
    chunkOverlap;
    constructor({ chunkSize = 2000, chunkOverlap = 200 } = {}) {
        this.chunkSize = chunkSize;
        this.chunkOverlap = chunkOverlap;
    }
    async splitText(text) {
        const embedding = await embeddingModel.embedContent(text);
        const vector = embedding.embedding.values;
        return this.calculateSemanticChunks(text, vector);
    }
    calculateSemanticChunks(text, vector) {
        const chunkLength = Math.floor(text.length / (vector.length / this.chunkSize));
        const chunks = [];
        for (let i = 0; i < text.length; i += chunkLength - this.chunkOverlap) {
            const end = Math.min(i + chunkLength, text.length);
            chunks.push(text.substring(i, end));
        }
        return chunks;
    }
}
