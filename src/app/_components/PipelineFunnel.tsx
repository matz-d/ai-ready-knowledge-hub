'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  aiReadyDocumentCount,
  inFlightDocumentCount,
  protectedDocumentCount,
  readyPercentFromCounts,
  type PipelineStatusCounts,
} from '../../lib/pipelineStatusCounts';

const POLL_INTERVAL_MS = 4000;

type PipelineFunnelProps = {
  /** null = Firestore 未接続（fallback 表示）。件数行を出さず説明だけ描画する。 */
  initialCounts: PipelineStatusCounts | null;
  /** Firestore 未接続時の AI-Ready 率（%）。 */
  initialReadyPercent: number;
};

export function PipelineFunnel({
  initialCounts,
  initialReadyPercent,
}: PipelineFunnelProps) {
  const router = useRouter();
  const [counts, setCounts] = useState(initialCounts);
  const inFlight = counts ? inFlightDocumentCount(counts) : 0;
  const polling = counts !== null && inFlight > 0;
  // 処理中→0 の遷移を一度だけ server 再描画に変換するためのフラグ。
  const wasPollingRef = useRef(polling);

  useEffect(() => {
    setCounts(initialCounts);
  }, [initialCounts]);

  useEffect(() => {
    if (!polling) {
      if (wasPollingRef.current) {
        wasPollingRef.current = false;
        // terminal へ到達した結果（一覧・KPI）は server component 側にあるので
        // ここで再描画を要求する。ポーリング自体はこれで停止する。
        router.refresh();
      }
      return;
    }

    wasPollingRef.current = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/pipeline/status');
        if (!res.ok) return;
        const data: { counts?: PipelineStatusCounts } = await res.json();
        if (data.counts) setCounts(data.counts);
      } catch {
        // 一時的な失敗は次の tick で再試行する。
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [polling, router]);

  const aiReady = counts ? aiReadyDocumentCount(counts) : null;
  const protectedDocs = counts ? protectedDocumentCount(counts) : null;
  const readyPercent = counts
    ? readyPercentFromCounts(counts)
    : initialReadyPercent;
  const failed = counts?.failed ?? 0;

  return (
    <section className="pipeline-panel" aria-labelledby="pipeline-heading">
      <div className="panel-heading-row">
        <div>
          <p className="chapter-kicker">自動処理の現在地</p>
          <h2 id="pipeline-heading">AI活用パイプライン</h2>
        </div>
        <div className="pipeline-chips">
          {polling ? (
            <span className="pipeline-chip pipeline-chip--active">
              処理中 {inFlight}件
            </span>
          ) : null}
          {failed > 0 ? (
            <span className="pipeline-chip pipeline-chip--failed">
              処理失敗 {failed}件
            </span>
          ) : null}
          <span className="readiness-chip">AI-Ready {readyPercent}%</span>
        </div>
      </div>
      <div className="pipeline-steps">
        <article className="pipeline-step">
          <span className="pipeline-step__number">01</span>
          <strong>取り込み</strong>
          {counts ? (
            <span className="pipeline-step__count">
              分類待ち <b>{counts.uploaded}</b>
            </span>
          ) : null}
          <small>散らばった PDF・CSV・メモ・スプレッドシートを集めて取り込む。</small>
        </article>
        <article className="pipeline-step">
          <span className="pipeline-step__number">02</span>
          <strong>分類</strong>
          {counts ? (
            <span className="pipeline-step__count">
              分類中 <b>{counts.curating}</b>
            </span>
          ) : null}
          <small>Curator が文書種別・機密度・AI利用方針を自動判定する。</small>
        </article>
        <article className="pipeline-step">
          <span className="pipeline-step__number">03</span>
          <strong>マスキング</strong>
          {counts ? (
            <span className="pipeline-step__count">
              マスキング中 <b>{counts.masking}</b>
            </span>
          ) : null}
          <small>Masker が個人情報を検出してマスキングし、安全化する。</small>
        </article>
        <article className="pipeline-step">
          <span className="pipeline-step__number">04</span>
          <strong>パッケージ</strong>
          {aiReady !== null && protectedDocs !== null ? (
            <span className="pipeline-step__count">
              AI利用可 <b>{aiReady}</b> / 保護中 <b>{protectedDocs}</b>
            </span>
          ) : null}
          <small>使える・除外・足りない・確認質問を整理して AI へ渡す。</small>
        </article>
      </div>
    </section>
  );
}
