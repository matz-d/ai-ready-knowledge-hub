# Google Sheets Drive export fixture

- Fixture file: `sample-drive-export.xlsx`
- Source spreadsheet ID: `1BEgJdyg8muyJYuXjnTLO41EibTjCDcjUsGdP_lb4RJM`
- Source spreadsheet URL: `https://docs.google.com/spreadsheets/d/1BEgJdyg8muyJYuXjnTLO41EibTjCDcjUsGdP_lb4RJM/edit`
- Source spreadsheet title: `aiknh-drive-export-fixture-20260512-v2`
- Shared Service Account: `aiknh-runner@ai-ready-knowledge-hub.iam.gserviceaccount.com` (`reader`)
- Export method: `gog sheets export <spreadsheetId> --format=xlsx` (Drive `files.export` with OOXML)

Sheet構成:

1. `SimpleTable`（ヘッダ + 数行）
2. `DateCells`（日付セル）
3. `FormulaMerged`（数式セル + merged cell）
4. `EmptySheet`（空シート）
