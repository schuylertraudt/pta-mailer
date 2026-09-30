/** Grade levels offered on the subscribe form. Adjust per school. */
export const GRADES = ["TK", "K", "1", "2", "3", "4", "5"] as const;
export type Grade = (typeof GRADES)[number];
