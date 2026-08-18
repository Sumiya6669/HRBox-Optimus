/**
 * Выгрузка в Excel (.xlsx).
 *
 * HR прямо просили «выгрузку, пригодную к анализу в Excel». CSV этому требованию
 * отвечает наполовину: Excel в русской локали открывает его одной колонкой, а
 * несколько разрезов в один плоский файл не помещаются. Поэтому здесь — настоящая
 * книга с отдельным листом на каждый разрез.
 *
 * Библиотека грузится динамически: она весит около 400 КБ, и тащить её в основной
 * бандл ради кнопки, которую нажимают раз в месяц, нельзя.
 */

/** Ширина колонок «на глаз» по самому длинному значению — иначе всё в решётках. */
function columnWidths(rows) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((key) => {
    const longest = rows.reduce((max, row) => {
      const len = String(row[key] ?? '').length;
      return len > max ? len : max;
    }, key.length);
    return { wch: Math.min(Math.max(longest + 2, 10), 50) };
  });
}

/**
 * @param {string} filename имя файла без расширения
 * @param {Array<{name: string, rows: Array<Object>}>} sheets листы книги;
 *        ключи объектов становятся заголовками колонок
 */
export async function downloadWorkbook(filename, sheets) {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();

  const usable = sheets.filter((s) => s && Array.isArray(s.rows) && s.rows.length);
  if (!usable.length) throw new Error('Нечего выгружать: за выбранный период данных нет');

  usable.forEach((sheet) => {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows);
    worksheet['!cols'] = columnWidths(sheet.rows);
    worksheet['!freeze'] = { xSplit: 0, ySplit: 1 };
    // Имя листа в Excel — не длиннее 31 символа и без спецсимволов.
    const safeName = sheet.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    XLSX.utils.book_append_sheet(book, worksheet, safeName);
  });

  XLSX.writeFile(book, `${filename}.xlsx`, { compression: true });
}
