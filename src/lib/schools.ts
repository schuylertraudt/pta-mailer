/** Elementary schools families choose as their home school. Adjust here if schools are added or renamed. */
export const SCHOOLS = ["Arongen", "Chango", "Karigon", "Okte", "Orenda", "Shatekon", "Skano", "Tesago"] as const;
export type School = (typeof SCHOOLS)[number];
