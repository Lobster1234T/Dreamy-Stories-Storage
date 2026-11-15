import type { ContentItem, Docs, Section } from './types.ts';

export interface MatrixCell {
  readonly item: ContentItem;
  readonly index: number;
}

export interface MatrixRow {
  readonly id: string;
  readonly title: string;
  readonly imagePath: string;
  readonly cells: Readonly<Record<string, MatrixCell | undefined>>;
  readonly presentIn: number;
}

/**
 * One row per story id, one column per geo. Rows follow the reference geo's
 * order; stories missing there are appended in the order they first appear.
 */
export function buildMatrix(docs: Docs, locales: readonly string[], reference: string, section: Section): MatrixRow[] {
  const order = [reference, ...locales.filter((code) => code !== reference)].filter((code) => docs[code]);
  const rowIds: string[] = [];
  const cellsById = new Map<string, Record<string, MatrixCell>>();
  for (const code of order) {
    docs[code][section].forEach((item, index) => {
      const key = item.id || `__no-id__${code}__${item.uid}`;
      if (!cellsById.has(key)) {
        cellsById.set(key, {});
        rowIds.push(key);
      }
      const cells = cellsById.get(key)!;
      if (!cells[code]) cells[code] = { item, index };
    });
  }
  return rowIds.map((id) => toRow(id, cellsById.get(id)!, order));
}

function toRow(id: string, cells: Record<string, MatrixCell>, order: readonly string[]): MatrixRow {
  const first = order.map((code) => cells[code]).find(Boolean)!;
  return {
    id,
    title: first.item.title,
    imagePath: first.item.imagePath,
    cells,
    presentIn: Object.keys(cells).length,
  };
}

export function missingLocales(row: MatrixRow, locales: readonly string[]): string[] {
  return locales.filter((code) => !row.cells[code]);
}
