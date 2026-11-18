export declare const CHAT_MAX: number;
export declare function tidyChat(raw: unknown): string;
export declare function checkChat(raw: unknown): { ok: true; text: string } | { ok: false; why: string };
export declare function chatRefusal(why: string): string;
