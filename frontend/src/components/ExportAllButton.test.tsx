/**
 * claude 수정 (2026-11-13): 전체 export 버튼(ExportAllButton) — 규칙 J(오류·진행 중 처리)와 일부 캡처 실패 경고 검증.
 * exportAll 은 가짜로 바꿔 호출 횟수·실패만 흉내 내고, 캡처 핸들은 테스트가 넘기는 결과를 돌려준다.
 */
import React, { createRef } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import i18n from '../i18n';
import ExportAllButton from './ExportAllButton';
import { ToastProvider } from './Toast';
import type { PagedDetailViewHandle } from './PagedDetailView';
import { exportAll, ExportAllScreenshots, ScreenshotCapture } from '../utils/detailExport';
import type { RequestDocument } from '../types';

jest.mock('../utils/detailExport', () => ({ exportAll: jest.fn() }));

const mockedExportAll = exportAll as jest.MockedFunction<typeof exportAll>;
const SHOT: ScreenshotCapture = { buffer: new ArrayBuffer(1), width: 1, height: 1 };
const ALL_SHOTS: ExportAllScreenshots = { detail: SHOT, map: SHOT, etc: SHOT, route: SHOT };
const doc = { id: 1, title: 'export-button-doc' } as unknown as RequestDocument;

const renderButton = (shots: ExportAllScreenshots | null) => {
  const ref = createRef<PagedDetailViewHandle>();
  if (shots) {
    (ref as React.MutableRefObject<PagedDetailViewHandle>).current = { captureAllScreenshots: async () => shots };
  }
  render(<ToastProvider><ExportAllButton doc={doc} pagedDetailViewRef={ref} /></ToastProvider>);
  return screen.getByRole('button');
};

beforeEach(async () => {
  await i18n.changeLanguage('ko');
  mockedExportAll.mockReset();
});

describe('전체 export 버튼', () => {
  it('정상이면 exportAll 을 한 번 부르고 토스트가 없다', async () => {
    mockedExportAll.mockResolvedValue(undefined);
    const button = renderButton(ALL_SHOTS);
    fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(mockedExportAll).toHaveBeenCalledTimes(1);
    expect(mockedExportAll.mock.calls[0][2]).toEqual(ALL_SHOTS);
    expect(screen.queryByText(i18n.t('request.export_capture_partial_failed'))).toBeNull();
    expect(screen.queryByText(i18n.t('request.export_all_error'))).toBeNull();
  });

  it('캡처 중 하나라도 실패하면 파일은 만들고 경고 토스트를 띄운다', async () => {
    mockedExportAll.mockResolvedValue(undefined);
    const button = renderButton({ ...ALL_SHOTS, route: null });
    fireEvent.click(button);
    expect(await screen.findByText(i18n.t('request.export_capture_partial_failed'))).toBeTruthy();
    expect(mockedExportAll).toHaveBeenCalledTimes(1);
  });

  it('상세 보기 핸들이 없으면 캡처 전부 실패로 보고 경고한다', async () => {
    mockedExportAll.mockResolvedValue(undefined);
    const button = renderButton(null);
    fireEvent.click(button);
    expect(await screen.findByText(i18n.t('request.export_capture_partial_failed'))).toBeTruthy();
    expect(mockedExportAll.mock.calls[0][2]).toEqual({ detail: null, map: null, etc: null, route: null });
  });

  it('exportAll 이 실패하면 오류 토스트를 띄우고 버튼이 다시 켜진다', async () => {
    mockedExportAll.mockRejectedValue(new Error('xlsx 생성 실패'));
    const button = renderButton(ALL_SHOTS);
    fireEvent.click(button);
    expect(await screen.findByText(i18n.t('request.export_all_error'))).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.textContent).toContain(i18n.t('request.export_all_btn'));
  });

  it('생성 중에는 비활성화·생성 중 라벨이고, 연타해도 한 번만 실행한다', async () => {
    let finish: () => void = () => undefined;
    mockedExportAll.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const button = renderButton(ALL_SHOTS);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    expect(button.textContent).toContain(i18n.t('request.export_all_generating'));
    fireEvent.click(button);
    await act(async () => { finish(); });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(mockedExportAll).toHaveBeenCalledTimes(1);
  });
});
