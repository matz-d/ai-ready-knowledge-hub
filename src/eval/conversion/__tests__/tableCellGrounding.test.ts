import { describe, expect, it } from 'vitest';
import {
  groundRowCells,
  isCellGroundedInPageText,
} from '../tableCellGrounding';

const PAGE_WITH_MONTH_HOURS =
  'Monthly overtime cap 45 hours Manager review\n月 45時間 上限';

describe('tableCellGrounding (shared PoC + production)', () => {
  it('keeps 月 + 45時間 when the month label is standalone', () => {
    expect(
      groundRowCells({
        cells: ['月', '45時間'],
        pageText: PAGE_WITH_MONTH_HOURS,
      })
    ).toEqual(['月', '45時間']);
  });

  it('rejects 時 when it would only match inside 45時間', () => {
    expect(
      groundRowCells({
        cells: ['時', '45時間'],
        pageText: PAGE_WITH_MONTH_HOURS,
      })
    ).toEqual([]);
    expect(isCellGroundedInPageText(PAGE_WITH_MONTH_HOURS, '時')).toBe(false);
  });

  it('keeps a checkbox marker when paired with substantive grounded cells', () => {
    const pageText = '項目名\t○\t備考欄';
    expect(
      groundRowCells({
        cells: ['項目名', '○', '備考欄'],
        pageText,
      })
    ).toEqual(['項目名', '○', '備考欄']);
  });

  it('treats a 1-char cell embedded in a longer token as not standalone', () => {
    expect(isCellGroundedInPageText('45時間', '時')).toBe(false);
  });

  it('treats a leading 月 before digits as standalone when separated', () => {
    expect(isCellGroundedInPageText('月 45時間', '月')).toBe(true);
  });
});
