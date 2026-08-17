/**
 * Выгрузка таблиц в CSV — один helper на весь портал.
 * Excel без BOM открывает кириллицу кракозябрами, поэтому BOM обязателен.
 */

const csvCell = (cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`;

/** buildCSV(['Дата','Сумма'], [['16.08.2026', 500]]) → строка CSV */
export function buildCSV(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

export function downloadCSV(filename, csvContent) {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
