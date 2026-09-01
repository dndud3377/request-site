/**
 * disableFilter / multiSelect 회귀 테스트.
 *
 * 배경: item_id 다중 선택 구현 리뷰 중 발견된 버그들을 재현해 고정한다.
 * 1) (st/new_or_copy 등 고정 선택지 필드) 값을 이미 고른 채 셀을 다시 열면, 그 값 문자열로
 *    옵션을 필터링해버려 일치하지 않는 나머지 옵션이 사라졌다 — disableFilter로 해결.
 * 2) (item_id) 후보를 1개 고르고 나면 그 값 전체가 "입력 중인 조각"으로 오인되어 드롭다운이
 *    그 항목 하나로만 필터링되고, 두 번째를 고를 수 없었다 — item_id도 disableFilter를 켜서
 *    같은 방식으로 해결하고, 전용으로 있던 임시방편 필터 판별 로직은 제거했다.
 * 3) (item_id) 직접 타이핑한 "[날짜]" 형식 텍스트가, 그 뒤에 다른 옵션을 하나 더 고르는 순간
 *    옵션에서 고른 값과 똑같이 취급되어 날짜가 지워져 버렸다(자유 입력 값의 출처를
 *    구분하지 않고 formatMultiValue에 넘겼기 때문).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AutocompleteInput from './AutocompleteInput';
import { stripDateBracket, formatMultiItemId } from '../pages/RequestPage/helpers';
import '../i18n';

function SingleSelectHarness(): React.ReactElement {
  const [value, setValue] = React.useState('O');
  return (
    <AutocompleteInput
      value={value}
      onChange={setValue}
      options={['O', 'O (D)', 'X']}
      disableFilter
    />
  );
}

function MultiSelectHarness(): React.ReactElement {
  const [value, setValue] = React.useState('');
  return (
    <AutocompleteInput
      value={value}
      onChange={setValue}
      options={['BC-1 [08/25]', 'BC-2 [08/26]', 'BC-3 [08/27]']}
      disableFilter
      multiSelect
      multiSelectIdentity={stripDateBracket}
      formatMultiValue={formatMultiItemId}
    />
  );
}

test('disableFilter가 켜져 있으면 값이 이미 선택돼 있어도 다시 열면 옵션 전체가 보인다 (st/new_or_copy 셀 버그)', () => {
  render(<SingleSelectHarness />);
  const input = screen.getByRole('textbox') as HTMLInputElement;

  fireEvent.focus(input);
  // 값이 'O'인 채로 다시 열어도 'O'를 포함하지 않는 'X'까지 전부 보여야 한다.
  expect(screen.getByText('O (D)')).toBeTruthy();
  expect(screen.getByText('X')).toBeTruthy();
});

test('후보를 순서대로 체크하면 하나씩 누적 선택된다 (bug: 1개 고르면 목록이 그것만 남던 문제)', () => {
  render(<MultiSelectHarness />);
  const input = screen.getByRole('textbox') as HTMLInputElement;

  fireEvent.focus(input);
  fireEvent.mouseDown(screen.getByText('BC-1 [08/25]'));
  expect(input.value).toBe('BC-1 [08/25]');

  // 첫 선택 뒤에도 나머지 후보가 계속 보여야 두 번째를 고를 수 있다(없으면 getByText가 던진다).
  fireEvent.mouseDown(screen.getByText('BC-2 [08/26]'));
  expect(input.value).toBe('BC-1, BC-2');

  fireEvent.mouseDown(screen.getByText('BC-3 [08/27]'));
  expect(input.value).toBe('BC-1, BC-2, BC-3');
});

test('직접 입력한 날짜 형식 텍스트는 다른 옵션을 골라도 그대로 유지된다 (bug: 날짜 유실)', () => {
  render(<MultiSelectHarness />);
  const input = screen.getByRole('textbox') as HTMLInputElement;

  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'custom_value [2026-01-01], ' } });
  fireEvent.mouseDown(screen.getByText('BC-1 [08/25]'));

  expect(input.value).toBe('custom_value [2026-01-01], BC-1');
});

test('2개 선택 후 1개를 해제하면 남은 항목은 날짜가 복원된다', () => {
  render(<MultiSelectHarness />);
  const input = screen.getByRole('textbox') as HTMLInputElement;

  fireEvent.focus(input);
  fireEvent.mouseDown(screen.getByText('BC-1 [08/25]'));
  fireEvent.mouseDown(screen.getByText('BC-2 [08/26]'));
  expect(input.value).toBe('BC-1, BC-2');

  fireEvent.mouseDown(screen.getByText('BC-2 [08/26]'));
  expect(input.value).toBe('BC-1 [08/25]');
});
