import { describe, it, expect } from 'vitest';
import {
  SECTIONS, SECTION_BY_KEY, sectionsByGroup, isSectionLocked, evaluateAccess,
} from './sections';

describe('каталог разделов', () => {
  it('ключи уникальны', () => {
    const keys = SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('каждый раздел принадлежит объявленной группе', () => {
    const groups = new Set(SECTIONS.map((s) => s.group));
    groups.forEach((g) => expect(sectionsByGroup(g).length).toBeGreaterThan(0));
  });

  it('разделы администрирования не открываются ниже HR', () => {
    SECTIONS.filter((s) => s.key.startsWith('admin.')).forEach((s) => {
      expect(['hr', 'admin']).toContain(s.minRole);
    });
  });
});

describe('evaluateAccess', () => {
  it('без ключа раздела доступ разрешён', () => {
    expect(evaluateAccess(null, 'employee', {})).toBe(true);
  });

  it('пока права не загружены, не показывает «нет доступа»', () => {
    expect(evaluateAccess('cabinet.kpi', 'employee', null)).toBe(true);
  });

  it('отсутствие записи означает «разрешено», а не «запрещено»', () => {
    // Иначе каждый новый раздел был бы закрыт для всех до первого сохранения.
    expect(evaluateAccess('cabinet.kpi', 'employee', {})).toBe(true);
  });

  it('явный запрет закрывает раздел', () => {
    expect(evaluateAccess('cabinet.kpi', 'employee', { 'cabinet.kpi': false })).toBe(false);
  });

  it('пол роли сильнее галочки: сотруднику не открыть журнал действий', () => {
    expect(evaluateAccess('admin.audit', 'employee', { 'admin.audit': true })).toBe(false);
    expect(evaluateAccess('admin.audit', 'admin', {})).toBe(true);
  });

  it('HR не попадает в разделы только для администратора', () => {
    expect(evaluateAccess('admin.users', 'hr', { 'admin.users': true })).toBe(false);
    expect(evaluateAccess('admin.employees', 'hr', {})).toBe(true);
  });
});

describe('защита от самоблокировки', () => {
  it('администратор не может закрыть себе управление доступом', () => {
    ['admin.users', 'admin.permissions', 'admin.settings'].forEach((key) => {
      expect(isSectionLocked(key, 'admin')).toBe(true);
    });
  });

  it('обычные разделы не заблокированы', () => {
    expect(isSectionLocked('admin.audit', 'admin')).toBe(false);
    expect(isSectionLocked('cabinet.kpi', 'employee')).toBe(false);
  });

  it('у заблокированных разделов есть описание для интерфейса', () => {
    Object.values(SECTION_BY_KEY).forEach((s) => expect(s.title).toBeTruthy());
  });
});
