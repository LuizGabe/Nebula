export const FOLDER_COLORS = ['neutral', 'violet', 'sage', 'sand', 'blue'] as const;

export function normalizeFolderColor(value: unknown): typeof FOLDER_COLORS[number] {
  return FOLDER_COLORS.includes(value as typeof FOLDER_COLORS[number])
    ? value as typeof FOLDER_COLORS[number] : 'neutral';
}
