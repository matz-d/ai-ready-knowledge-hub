# Upload Multi-File Live Smoke — 2026-06-18

Purpose: verify the current production `/upload` UI can accept multiple selected
files and process them sequentially through the live Cloud Run environment. This
does not validate local directory picker or zip bulk ingest; those remain product
scope decisions for P3 Ingest.

## Runtime

- Project: `ai-ready-knowledge-hub`
- Production URL: `https://ai-ready-knowledge-hub-mrvutsz24a-an.a.run.app/upload`
- Cloud Run service: `ai-ready-knowledge-hub`
- Region: `asia-northeast1`
- Revision: `ai-ready-knowledge-hub-00069-2fn`
- Env: `FIRESTORE_PREFER_REST=false`
- Access path: Chrome session through Cloud Run IAP with `makoto@m-grow-ai.com`
- Input directory: `sample-data/accounting-office/`
- Selected files: `10`
- UI completion: `10/10`

## Result

The production UI accepted a 10-file selection and processed every item. One
synthetic contract sample was correctly restricted, and the remaining files
continued to completion.

| File | Document ID | Firestore status | Sensitivity | Delivery |
| --- | --- | --- | --- | --- |
| `給与計算_例外対応メモ.txt` | `de2d2835-85b2-4145-9666-f19e3daf07ae` | `curated` | `Internal` | `direct` |
| `給与計算チェックリスト.md` | `100cedf5-6a67-4bb5-b264-de388a642a8c` | `curated` | `Public` | `direct` |
| `料金表_2023.csv` | `8be31bf1-cb41-4531-8e90-0cd467257d9e` | `curated` | `Internal` | `direct` |
| `顧客対応メモ_書式.md` | `b05fc72e-76c4-4019-977d-6af66d9e03aa` | `curated` | `Public` | `direct` |
| `顧客対応メモ_匿名化.txt` | `3fa6bcbb-b2db-4b91-b38a-b0756d03a027` | `curated` | `Internal` | `direct` |
| `顧問契約書_実案件サンプル.txt` | `461b9593-a52b-4bab-9396-dc7a0ad923cb` | `restricted` | `Restricted` | `blocked` |
| `顧問契約書テンプレ.md` | `3da69939-a759-44c6-bbbb-98f29fe656e4` | `curated` | `Public` | `direct` |
| `就業規則テンプレート.md` | `41edf2b4-fba4-4026-b5b2-209de23c7d8f` | `curated` | `Public` | `direct` |
| `年末調整_案内文.txt` | `bc54716a-513a-463c-8254-b1460da93c4e` | `curated` | `Public` | `direct` |
| `料金表_2026.csv` | `c7f41539-8072-4888-af38-9d549093a614` | `curated` | `Public` | `direct` |

The restricted document showed Masker `restricted_promoted`,
`maskedSpansCount: 10`, and residual-risk detection. The restriction reason
noted remaining address information, which is the expected safety posture for
this fixture.

## Log Evidence

Cloud Run request logs showed 10 successful upload requests:

- Path: `POST /api/documents`
- Status: HTTP `200` for all 10 requests
- Revision: `ai-ready-knowledge-hub-00069-2fn`
- Referer: production `/upload`
- Window: `2026-06-18T04:44:44.819295Z` to
  `2026-06-18T04:45:37.916972Z`
- Observed request latencies: about `3.873s` to `12.182s`

Negative checks for the same window:

- No `upload processing failed` log entries observed.
- No `toProto3JSON: don't know how to convert value 2` log entries observed.

## Scope Note

This smoke validates the currently shipped multi-file queue behavior: selecting
multiple files in the existing upload UI and processing them one by one. It does
not prove a local directory picker or zip ingest workflow, because those are not
currently productized paths.
