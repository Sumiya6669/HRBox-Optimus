import { useEffect, useRef, useState } from 'react';

/**
 * Черновик формы, переживающий перезагрузку страницы.
 *
 * Первопричину потери данных мы устранили в AuthContext: страница больше не
 * перемонтируется при возврате на вкладку. Но перезагрузка бывает и по другим
 * причинам — обновили страницу сами, сорвалась сеть, браузер выгрузил вкладку
 * на телефоне. Длинную форму после этого приходилось заполнять заново.
 *
 * Поэтому черновик пишется в sessionStorage. Именно session, а не local:
 * данные живут ровно до закрытия вкладки и не всплывают через неделю на чужом
 * компьютере, куда человек зашёл под своей учёткой.
 *
 * `null` означает «форма закрыта» — в этом состоянии черновик стирается.
 *
 * @param {string} key     уникальный ключ формы
 * @param {*}      initial начальное значение (обычно null для диалога)
 */
export function useFormDraft(key, initial = null) {
  const storageKey = `draft:${key}`;

  const [value, setValue] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : initial;
    } catch {
      return initial;
    }
  });

  // Первую запись пропускаем: иначе только что восстановленный черновик тут же
  // перезаписывался бы сам собой, и толку от него не было бы.
  const skipFirst = useRef(true);
  const lastKey = useRef(storageKey);

  /*
   * Ключ может смениться без размонтирования компонента — например, при
   * переходе с одного курса на другой внутри одного маршрута. Без этой
   * перезагрузки черновик первого курса «переехал» бы во второй и сохранился
   * бы уже под его ключом.
   */
  useEffect(() => {
    if (lastKey.current === storageKey) return;
    lastKey.current = storageKey;
    skipFirst.current = true;
    try {
      const saved = sessionStorage.getItem(storageKey);
      setValue(saved ? JSON.parse(saved) : initial);
    } catch {
      setValue(initial);
    }
    // initial намеренно вне зависимостей: это константа формы, а не значение,
    // за изменением которого нужно следить.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return; }
    try {
      if (value === null || value === undefined) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Приватный режим или переполненное хранилище — черновик просто не
      // сохранится. Ронять из-за этого форму нельзя.
    }
  }, [value, storageKey]);

  /** Явно убрать черновик — после успешного сохранения или отмены. */
  const clear = () => {
    try { sessionStorage.removeItem(storageKey); } catch { /* см. выше */ }
    setValue(initial);
  };

  return [value, setValue, clear];
}

export default useFormDraft;
