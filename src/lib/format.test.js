import { describe, it, expect } from 'vitest';
import { leaveDays, tenureYears, plural, formatSigned, formatDate, isPast, daysUntilBirthday } from './format';

describe('leaveDays — BUG-017', () => {
  it('период 2026-08-10 → 2026-08-17 всегда равен 8 дням', () => {
    expect(leaveDays('2026-08-10', '2026-08-17')).toBe(8);
  });
  it('один день = 1', () => {
    expect(leaveDays('2026-08-10', '2026-08-10')).toBe(1);
  });
  it('перевёрнутый период не даёт отрицательных дней', () => {
    expect(leaveDays('2026-08-17', '2026-08-10')).toBe(0);
  });
  it('переход через месяц', () => {
    expect(leaveDays('2026-07-30', '2026-08-02')).toBe(4);
  });
  it('пустые значения безопасны', () => {
    expect(leaveDays(null, '2026-08-10')).toBe(0);
  });
});

describe('tenureYears — BUG-021/022', () => {
  it('годовщина ещё не наступила', () => {
    expect(tenureYears('2012-12-01', new Date(2026, 7, 16))).toBe(13);
  });
  it('годовщина уже прошла', () => {
    expect(tenureYears('2012-03-01', new Date(2026, 7, 16))).toBe(14);
  });
  it('ровно в день годовщины засчитывается полный год', () => {
    expect(tenureYears('2021-08-16', new Date(2026, 7, 16))).toBe(5);
  });
});

describe('plural — BUG-075/077', () => {
  it('1 сотрудник', () => expect(plural(1, 'сотрудник', 'сотрудника', 'сотрудников')).toBe('сотрудник'));
  it('3 сотрудника', () => expect(plural(3, 'сотрудник', 'сотрудника', 'сотрудников')).toBe('сотрудника'));
  it('11 сотрудников', () => expect(plural(11, 'сотрудник', 'сотрудника', 'сотрудников')).toBe('сотрудников'));
  it('21 сотрудник', () => expect(plural(21, 'сотрудник', 'сотрудника', 'сотрудников')).toBe('сотрудник'));
});

describe('formatSigned — BUG-056', () => {
  it('ноль без знака', () => expect(formatSigned(0)).toBe('0'));
  it('минус для отрицательных', () => expect(formatSigned(-400)).toBe('−400'));
  it('плюс для положительных', () => expect(formatSigned(500)).toBe('+500'));
});

describe('formatDate — BUG-053', () => {
  it('единый короткий формат', () => expect(formatDate('2026-07-28')).toBe('28.07.2026'));
  it('пустое значение', () => expect(formatDate(null)).toBe('—'));
});

describe('isPast — BUG-019/024/041', () => {
  it('вчерашняя дата в прошлом', () => expect(isPast('2026-08-15', new Date(2026, 7, 16))).toBe(true));
  it('сегодняшняя дата не в прошлом', () => expect(isPast('2026-08-16', new Date(2026, 7, 16))).toBe(false));
});

describe('daysUntilBirthday', () => {
  it('день рождения сегодня', () => expect(daysUntilBirthday('1990-08-16', new Date(2026, 7, 16))).toBe(0));
  it('день рождения в следующем году', () => expect(daysUntilBirthday('1990-01-10', new Date(2026, 7, 16))).toBe(147));
});
