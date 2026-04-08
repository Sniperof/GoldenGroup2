import { Candidate, Client } from './types';

/**
 * Calculates the Levenshtein distance between two strings.
 */
export function calculateLevenshteinDistance(s1: string, s2: string): number {
    const len1 = s1.length;
    const len2 = s2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) matrix[i] = [i];
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[len1][len2];
}

/**
 * Calculates percentage similarity between two strings using Levenshtein distance.
 */
export function calculateSimilarity(s1: string, s2: string): number {
    const str1 = s1.toLowerCase().trim();
    const str2 = s2.toLowerCase().trim();
    if (str1 === str2) return 100;
    if (str1.length === 0 || str2.length === 0) return 0;

    const distance = calculateLevenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    return ((maxLength - distance) / maxLength) * 100;
}

export type ConfidenceScore = 'High' | 'Medium' | 'Low';

export interface SearchResult {
    entity: Client | Candidate;
    recordType: 'Client' | 'Candidate';
    confidence: ConfidenceScore;
    score: number;
}

/**
 * Performs a "Smart Search" on both clients and candidates arrays.
 */
export function performSmartSearch(searchTerms: Partial<Candidate>, clients: Client[], candidates: Candidate[] = []): SearchResult[] {
    const results: SearchResult[] = [];
    const SIMILARITY_THRESHOLD = 85;

    const queryMobile = searchTerms.mobile?.trim();
    const queryFirstName = searchTerms.firstName?.trim() || searchTerms.nickname?.trim() || '';
    const queryLastName = searchTerms.lastName?.trim() || '';
    const queryFullName = `${queryFirstName} ${queryLastName}`.trim();

    // 1. Search in Clients
    for (const client of clients) {
        let confidence: ConfidenceScore | null = null;
        let score = 0;

        const clientContacts = client.contacts || [];
        const hasMobileMatch = (client.mobile?.trim() === queryMobile) ||
            clientContacts.some(c => c.number?.trim() === queryMobile);

        if (queryMobile && hasMobileMatch) {
            confidence = 'High';
            score = 100;
        }

        if (!confidence && queryFullName && client.name) {
            const similarity = calculateSimilarity(queryFullName, client.name);
            if (similarity >= SIMILARITY_THRESHOLD) {
                confidence = 'Medium';
                score = similarity;
            }
        }

        if (confidence) {
            results.push({ entity: client, recordType: 'Client', confidence, score });
        }
    }

    // 2. Search in Candidates
    for (const cand of candidates) {
        let confidence: ConfidenceScore | null = null;
        let score = 0;

        const candContacts = cand.contacts || [];
        const candMobile = cand.mobile?.trim();
        const candFirstName = cand.firstName?.trim() || cand.nickname?.trim() || '';
        const candLastName = cand.lastName?.trim() || '';
        const candFullName = `${candFirstName} ${candLastName}`.trim();

        const hasMobileMatch = (candMobile === queryMobile) ||
            candContacts.some(c => c.number?.trim() === queryMobile);

        if (queryMobile && hasMobileMatch) {
            confidence = 'High';
            score = 100;
        }

        if (!confidence && queryFullName && candFullName) {
            const similarity = calculateSimilarity(queryFullName, candFullName);
            if (similarity >= SIMILARITY_THRESHOLD) {
                confidence = 'Medium';
                score = similarity;
            }
        }

        if (confidence) {
            results.push({ entity: cand, recordType: 'Candidate', confidence, score });
        }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 10);
}
