export declare const EXTRACT_ENTITIES_METHOD: "mocu.extract.entities";
export interface ExtractEntitiesParams {
    text: string;
    entities: Record<string, string>;
    threshold?: number;
    top_n?: number;
}
export interface ExtractedEntity {
    type: string;
    text: string;
    confidence: number;
    start: number;
    end: number;
    context: string;
}
export interface ExtractEntitiesResult {
    entities: ExtractedEntity[];
}
//# sourceMappingURL=extract.d.ts.map