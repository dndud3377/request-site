import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { documentsAPI } from '../api/client';
import { AnnualDesignRuleStats, DesignRuleBucket, DesignRuleDeltaState } from '../types';
import DesignRuleClassifyModal from './DesignRuleClassifyModal';

// ── 차트 기하 상수 ───────────────────────────────────────────────────────────
const PAD_LEFT = 46;
const PAD_RIGHT = 14;
const PAD_TOP_COMPARE = 30;   // 증감 배지가 들어갈 여유
const PAD_TOP_PLAIN = 20;
const PAD_BOTTOM = 62;        // 회전한 X축 라벨 + 선택 표시 캐럿
const CHART_HEIGHT = 316;
const BAND_COMPARE = 62;      // 그룹형(막대 2개)일 때 카테고리 폭
const BAND_PLAIN = 46;
const BAR_MAX_COMPARE = 20;
const BAR_MAX_PLAIN = 24;
const BAR_GAP = 2;            // 인접 막대를 갈라주는 surface gap
const BAR_RADIUS = 4;         // 데이터 끝(위쪽)만 둥글게, baseline 은 각지게
const Y_TICKS = 5;
const FALLBACK_PLOT_WIDTH = 1000;
const LABEL_ANGLE = -38;

// 시리즈 색 — validate_palette.js 전 항목 통과(surface #ffffff, 전체쌍 CVD ΔE 29.9)
const COLOR_BASE = '#2563eb';
const COLOR_COMPARE = '#eb6834';

const TOP_OPTIONS: readonly (number | 'all')[] = [10, 20, 30, 'all'];

/** 증감 배지에 붙일 화살표. 색만으로는 적록색약에서 구분이 어려워 반드시 함께 렌더한다. */
const DELTA_ARROW: Record<DesignRuleDeltaState, string> = {
  up: '▲',
  down: '▼',
  flat: '',
  new: '',
};

interface Props {
  /** MASTER 만 미분류 드릴다운에서 '분류하기' 버튼을 볼 수 있다. */
  isMaster: boolean;
}

/** 눈금이 깔끔한 축 상한. */
function niceMax(value: number): number {
  if (value <= 0) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(value))) / 2;
  const max = Math.ceil(value / step) * step;
  return max === value ? max + step : max;
}

/** 위쪽 두 모서리만 둥근 막대 path. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(BAR_RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}`
    + `H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

export default function AnnualDesignRuleChart({ isMaster }: Props): React.ReactElement | null {
  const { t } = useTranslation();

  const [stats, setStats] = useState<AnnualDesignRuleStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [year, setYear] = useState<number | null>(null);
  const [compareOn, setCompareOn] = useState(false);
  const [compareYear, setCompareYear] = useState<number | null>(null);
  const [top, setTop] = useState<number | 'all'>(10);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [showClassify, setShowClassify] = useState(false);

  const [plotWidth, setPlotWidth] = useState(FALLBACK_PLOT_WIDTH);
  const plotRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await documentsAPI.annualDesignRuleStats({
        year: year ?? undefined,
        compare: compareOn && compareYear !== null ? compareYear : undefined,
        top,
      });
      setStats(res.data);
      // 최초 로드에서는 서버가 정한 기본 연도를 그대로 따른다.
      if (year === null && res.data.year !== null) setYear(res.data.year);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [year, compareOn, compareYear, top]);

  useEffect(() => { void load(); }, [load]);

  // 카드 폭에 맞춰 그래프를 늘린다(막대가 많으면 가로 스크롤).
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const update = (): void => setPlotWidth(el.clientWidth || FALLBACK_PLOT_WIDTH);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stats]);

  const years = stats?.available_years ?? [];
  const compareActive = compareOn && stats?.compare_year !== null && stats?.compare_year !== undefined;

  // 비교 후보에서 기준 연도는 뺀다(같은 연도끼리 비교는 의미가 없다).
  const compareCandidates = useMemo(
    () => years.filter((y) => y !== stats?.year),
    [years, stats?.year],
  );

  const handleToggleCompare = useCallback(() => {
    setCompareOn((on) => {
      const next = !on;
      if (next && compareYear === null && compareCandidates.length > 0) {
        // 기본 비교 대상은 기준 연도 바로 이전 연도.
        const earlier = compareCandidates.filter((y) => stats?.year !== null && y < (stats?.year ?? 0));
        setCompareYear(earlier.length > 0 ? earlier[earlier.length - 1] : compareCandidates[0]);
      }
      return next;
    });
  }, [compareYear, compareCandidates, stats?.year]);

  const handleYearChange = useCallback((next: number) => {
    setYear(next);
    setOpenKey(null);
    // 새 기준 연도와 비교 연도가 겹치면 비교 대상을 비워 서버 기본값에 맡긴다.
    setCompareYear((cy) => (cy === next ? null : cy));
  }, []);

  const bucketLabel = useCallback((bucket: DesignRuleBucket): string => {
    if (bucket.kind === 'etc') return t('home.chart.bucket_etc_with_count', { count: bucket.member_count });
    if (bucket.kind === 'unclassified') return t('home.chart.bucket_unclassified');
    return bucket.label;
  }, [t]);

  const deltaText = useCallback((bucket: DesignRuleBucket): string => {
    if (bucket.delta_state === null) return '';
    if (bucket.delta_state === 'new') return t('home.chart.delta_new');
    if (bucket.delta_pct === null) return '';
    return `${DELTA_ARROW[bucket.delta_state]}${Math.abs(bucket.delta_pct).toFixed(1)}%`;
  }, [t]);

  const openBucket = useMemo(
    () => stats?.buckets.find((b) => b.key === openKey) ?? null,
    [stats, openKey],
  );

  if (loading && !stats) {
    return (
      <div className="card adr-card">
        <div className="adr-state">{t('home.chart.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card adr-card">
        <div className="adr-state">
          <span>{t('home.chart.error')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            {t('home.chart.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!stats || stats.year === null || stats.buckets.length === 0) {
    return (
      <div className="card adr-card">
        <div className="adr-head">
          <div>
            <h3 className="adr-title">{t('home.chart.title')}</h3>
            <p className="adr-desc">{t('home.chart.subtitle')}</p>
          </div>
        </div>
        <div className="adr-state">{t('home.chart.empty')}</div>
      </div>
    );
  }

  const buckets = stats.buckets;
  const padTop = compareActive ? PAD_TOP_COMPARE : PAD_TOP_PLAIN;
  const plotHeight = CHART_HEIGHT - padTop - PAD_BOTTOM;
  const minBand = compareActive ? BAND_COMPARE : BAND_PLAIN;
  const needed = PAD_LEFT + PAD_RIGHT + buckets.length * minBand;
  const width = Math.max(plotWidth, needed);
  const band = (width - PAD_LEFT - PAD_RIGHT) / buckets.length;

  const maxValue = buckets.reduce(
    (m, b) => Math.max(m, b.count, compareActive ? (b.compare_count ?? 0) : 0),
    0,
  );
  const axisMax = niceMax(maxValue);
  const baseline = padTop + plotHeight;
  const scale = (v: number): number => (axisMax === 0 ? 0 : plotHeight * v / axisMax);

  const barWidth = compareActive
    ? Math.min(BAR_MAX_COMPARE, (band - 16) / 2)
    : Math.min(BAR_MAX_PLAIN, band - 18);

  return (
    <div className="card adr-card">
      <div className="adr-head">
        <div>
          <h3 className="adr-title">{t('home.chart.title')}</h3>
          <p className="adr-desc">{t('home.chart.subtitle')}</p>
        </div>
      </div>

      {/* ── 조작부 ── */}
      <div className="adr-toolbar">
        <div className="adr-yearchips">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              className={`adr-chip${y === stats.year ? ' active' : ''}`}
              onClick={() => handleYearChange(y)}
            >
              {t('home.chart.year_option', { year: y })}
            </button>
          ))}
        </div>

        <div className="adr-toolbar-spacer" />

        <button
          type="button"
          className={`btn btn-sm${compareOn ? ' btn-primary' : ' btn-secondary'}`}
          onClick={handleToggleCompare}
        >
          ⇄ {t('home.chart.compare')}
        </button>

        <label className="adr-ctl">
          {t('home.chart.compare_label')}
          <select
            className="form-control adr-select"
            value={stats.compare_year ?? ''}
            disabled={!compareOn || compareCandidates.length === 0}
            onChange={(e) => { setCompareYear(Number(e.target.value)); setOpenKey(null); }}
          >
            {compareCandidates.map((y) => (
              <option key={y} value={y}>{t('home.chart.compare_year_option', { year: y })}</option>
            ))}
          </select>
        </label>

        <label className="adr-ctl">
          {t('home.chart.top_label')}
          <select
            className="form-control adr-select"
            value={String(top)}
            onChange={(e) => {
              const raw = e.target.value;
              setTop(raw === 'all' ? 'all' : Number(raw));
              setOpenKey(null);
            }}
          >
            {TOP_OPTIONS.map((opt) => (
              <option key={String(opt)} value={String(opt)}>
                {opt === 'all' ? t('home.chart.top_all') : t('home.chart.top_option', { count: opt })}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={`btn btn-sm${showTable ? ' btn-primary' : ' btn-secondary'}`}
          onClick={() => setShowTable((v) => !v)}
        >
          {t('home.chart.table_view')}
        </button>
      </div>

      {/* ── 범례 (2계열이면 항상 노출, 색 의존을 없애기 위함) ── */}
      <div className="adr-legend">
        <span className="adr-lg">
          <span className="adr-sw" style={{ background: COLOR_BASE }} />
          {t('home.chart.legend_base', { year: stats.year })}
        </span>
        {compareActive && (
          <>
            <span className="adr-lg">
              <span className="adr-sw" style={{ background: COLOR_COMPARE }} />
              {t('home.chart.legend_compare', { year: stats.compare_year })}
            </span>
            <span className="adr-lg">
              <b className="adr-up">▲</b> {t('home.chart.legend_up')}
              <b className="adr-down">▼</b> {t('home.chart.legend_down')}
            </span>
          </>
        )}
        <span className="adr-hint">{t('home.chart.click_hint')}</span>
      </div>

      {/* ── 그래프 ── */}
      <div className="adr-plot" ref={plotRef}>
        <svg
          role="img"
          aria-label={t('home.chart.aria_chart')}
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          width={width}
          height={CHART_HEIGHT}
        >
          <defs>
            {/* 미분류는 색이 아닌 해칭으로도 구분되게 한다(특수 버킷 신호). */}
            <pattern id="adrHatchBase" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={COLOR_BASE} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#fff" strokeWidth="2" opacity="0.55" />
            </pattern>
            <pattern id="adrHatchCompare" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={COLOR_COMPARE} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#fff" strokeWidth="2" opacity="0.55" />
            </pattern>
          </defs>

          {Array.from({ length: Y_TICKS + 1 }, (_, i) => {
            const value = axisMax * i / Y_TICKS;
            const y = baseline - scale(value);
            return (
              <g key={i}>
                <line className="adr-gridline" x1={PAD_LEFT} y1={y} x2={width - PAD_RIGHT} y2={y} />
                <text className="adr-ytick" x={PAD_LEFT - 9} y={y + 3.5} textAnchor="end">
                  {Math.round(value)}
                </text>
              </g>
            );
          })}
          <line className="adr-axis" x1={PAD_LEFT} y1={baseline} x2={width - PAD_RIGHT} y2={baseline} />

          {buckets.map((bucket, index) => {
            const cx = PAD_LEFT + index * band + band / 2;
            const dimmed = openKey !== null && openKey !== bucket.key;
            const hatched = bucket.kind === 'unclassified';
            const fillBase = hatched ? 'url(#adrHatchBase)' : COLOR_BASE;
            const fillCompare = hatched ? 'url(#adrHatchCompare)' : COLOR_COMPARE;
            const label = bucketLabel(bucket);
            const delta = deltaText(bucket);
            const baseHeight = scale(bucket.count);
            const compareHeight = scale(bucket.compare_count ?? 0);

            return (
              <g key={bucket.key}>
                <g className={dimmed ? 'adr-group dimmed' : 'adr-group'}>
                  {compareActive ? (
                    <>
                      <path
                        d={barPath(cx - barWidth - BAR_GAP / 2, baseline - baseHeight, barWidth, baseHeight)}
                        fill={fillBase}
                      />
                      <path
                        d={barPath(cx + BAR_GAP / 2, baseline - compareHeight, barWidth, compareHeight)}
                        fill={fillCompare}
                      />
                      {delta && (
                        <text
                          className={`adr-dbadge ${bucket.delta_state ?? 'flat'}`}
                          x={cx}
                          y={baseline - Math.max(baseHeight, compareHeight) - 8}
                          textAnchor="middle"
                        >
                          {delta}
                        </text>
                      )}
                    </>
                  ) : (
                    <>
                      <path
                        d={barPath(cx - barWidth / 2, baseline - baseHeight, barWidth, baseHeight)}
                        fill={fillBase}
                      />
                      <text className="adr-barvalue" x={cx} y={baseline - baseHeight - 6} textAnchor="middle">
                        {bucket.count}
                      </text>
                    </>
                  )}
                </g>

                {/* 막대보다 넉넉한 클릭·호버 영역 */}
                <rect
                  className="adr-hit"
                  x={cx - band / 2}
                  y={padTop}
                  width={band}
                  height={plotHeight}
                  onClick={() => setOpenKey((k) => (k === bucket.key ? null : bucket.key))}
                >
                  <title>
                    {`${label}\n${t('home.chart.drill_meta', { year: stats.year, count: bucket.count })}`
                      + (compareActive
                        ? `\n${t('home.chart.drill_meta_compare', { year: stats.compare_year, count: bucket.compare_count ?? 0 })}`
                        : '')
                      + (delta ? `\n${delta}` : '')}
                  </title>
                </rect>

                <text
                  className={
                    `adr-xlab${bucket.kind !== 'rule' ? ' special' : ''}`
                    + `${openKey === bucket.key ? ' selected' : ''}`
                  }
                  x={cx}
                  y={baseline + 16}
                  textAnchor="end"
                  transform={`rotate(${LABEL_ANGLE} ${cx} ${baseline + 16})`}
                >
                  {label}
                </text>

                {openKey === bucket.key && (
                  <path
                    className="adr-caret"
                    d={`M${cx - 5},${baseline + 30} L${cx + 5},${baseline + 30} L${cx},${baseline + 38} Z`}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── 표 보기 (색에 의존하지 않는 대체 표현) ── */}
      {showTable && (
        <div className="table-wrapper adr-table">
          <table className="table">
            <thead>
              <tr>
                <th>{t('home.chart.col_design_rule')}</th>
                <th>{t('home.chart.year_option', { year: stats.year })}</th>
                {compareActive && <th>{t('home.chart.year_option', { year: stats.compare_year })}</th>}
                {compareActive && <th>{t('home.chart.col_delta')}</th>}
                {stats.purposes.map((p) => <th key={p}>{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.key}>
                  <td>{bucketLabel(bucket)}</td>
                  <td><b>{bucket.count}</b></td>
                  {compareActive && <td>{bucket.compare_count ?? 0}</td>}
                  {compareActive && (
                    <td className={`adr-${bucket.delta_state ?? 'flat'}`}>{deltaText(bucket) || '-'}</td>
                  )}
                  {stats.purposes.map((p) => <td key={p}>{bucket.purposes[p] ?? 0}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 드릴다운 ── */}
      {openBucket && (
        <div className="adr-drill">
          <div className="adr-drill-head">
            <span className="adr-drill-title">
              {t('home.chart.drill_title', { name: bucketLabel(openBucket) })}
            </span>
            <span className="adr-drill-meta">
              {t('home.chart.drill_meta', { year: stats.year, count: openBucket.count })}
              {compareActive && ` · ${t('home.chart.drill_meta_compare', {
                year: stats.compare_year, count: openBucket.compare_count ?? 0,
              })}`}
            </span>
            <button
              type="button"
              className="adr-drill-close"
              onClick={() => setOpenKey(null)}
              title={t('home.chart.drill_close')}
            >
              ×
            </button>
          </div>

          <div className="adr-kpis">
            {stats.purposes.map((purpose) => {
              const value = openBucket.purposes[purpose] ?? 0;
              const prev = openBucket.compare_purposes?.[purpose] ?? 0;
              // 목적 카드의 증감은 막대와 같은 규칙으로 별도 계산한다.
              let state: DesignRuleDeltaState | null = null;
              let text = '';
              if (compareActive) {
                if (prev === 0) {
                  state = value > 0 ? 'new' : 'flat';
                  text = value > 0 ? t('home.chart.delta_new') : '0.0%';
                } else {
                  const pct = (value - prev) / prev * 100;
                  state = Math.abs(pct) < 0.05 ? 'flat' : (pct > 0 ? 'up' : 'down');
                  text = `${DELTA_ARROW[state]}${Math.abs(pct).toFixed(1)}%`;
                }
              }
              return (
                <div className="adr-kpi" key={purpose}>
                  <div className="adr-kpi-label">{purpose}</div>
                  <div className="adr-kpi-value">
                    {value}<span className="adr-kpi-unit">{t('home.chart.unit_count')}</span>
                  </div>
                  {compareActive && state && (
                    <span className={`adr-kpi-delta ${state}`}>{text}</span>
                  )}
                  {compareActive && (
                    <div className="adr-kpi-prev">
                      {t('home.chart.drill_prev', { year: stats.compare_year, count: prev })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {openBucket.kind === 'etc' && stats.top !== null && (
            <div className="adr-drill-foot">
              <div className="adr-notice info">{t('home.chart.etc_notice', { count: stats.top })}</div>
            </div>
          )}

          {openBucket.kind === 'unclassified' && (
            <div className="adr-drill-foot">
              <div className="adr-notice">⚠ {t('home.chart.unclassified_notice')}</div>
              {isMaster && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowClassify(true)}>
                  🗂 {t('home.chart.classify')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showClassify && (
        <DesignRuleClassifyModal
          year={stats.year}
          onClose={() => setShowClassify(false)}
          onSaved={() => { setShowClassify(false); void load(); }}
        />
      )}
    </div>
  );
}
