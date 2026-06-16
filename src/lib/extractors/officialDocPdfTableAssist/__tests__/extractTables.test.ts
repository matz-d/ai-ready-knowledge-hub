import { describe, expect, it } from 'vitest';
import {
  OfficialDocTableAssistError,
  parseJsonFromModelText,
  parseTableOnlyOutput,
} from '../extractTables';

describe('parseJsonFromModelText', () => {
  it('parses fenced JSON', () => {
    expect(parseJsonFromModelText('```json\n{"rows":[{"cells":["A","B"]}]}\n```')).toEqual({
      rows: [{ cells: ['A', 'B'] }],
    });
  });
});

describe('parseTableOnlyOutput', () => {
  it('falls back from invalid output to text', () => {
    expect(
      parseTableOnlyOutput({
        output: { rows: [{ cells: [123] }] },
        text: '{"rows":[{"cells":["A","B"]}]}',
      })
    ).toEqual({ rows: [{ cells: ['A', 'B'] }] });
  });

  it('treats empty rows as success', () => {
    expect(parseTableOnlyOutput({ output: { rows: [] } })).toEqual({ rows: [] });
  });

  it('throws when neither output nor text satisfies the schema', () => {
    expect(() =>
      parseTableOnlyOutput({
        output: { rows: [{ cells: [123] }] },
        text: '{"rows":[{"cells":[456]}]}',
      })
    ).toThrow(OfficialDocTableAssistError);
  });
});
