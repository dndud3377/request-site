"""실제 개발 DB 의 마스터 데이터를 그대로 읽어 상신용 재료를 만든다.

화면(RequestPage)이 쓰는 것과 **같은 form-options API** 를 같은 순서로 호출한다:
  라인 → 조합법(process) → 제품(product) → process_id → JOB FILE layer
따라서 여기서 나온 값은 사용자가 화면에서 고를 수 있는 값과 동일하다(가짜 값이 아니다).

E(MASK) 단계 판정에 쓰이는 `plel` 키워드는 J-layer 행의 `pp` 에서 찾는데,
화면이 `pp = item.recipeid` 로 채우므로(`RequestPage/index.tsx`
`fetchJobFileLayerAndPopulateJayer`) 여기서도 recipeid 를 본다.
"""

from .client import as_list

VALIDATION_KEYWORD = 'plel'  # backend RequestDocument.VALIDATION_KEYWORD 와 같은 값

# 역할 → 이 역할이 필요한 이유(부족할 때 SKIP 사유로 출력)
REQUIRED_ROLES = {
    'PL': '의뢰서 작성·상신, 지정 PL, 영업/기술지원 합의자, 추가 후결자',
    'TE_R': 'R(RFG) 담당자·검토자(RV), 고정 후결자',
    'TE_P': 'P(PHPSI) 담당자·검토자(PV)',
    'TE_J': 'J(JOB) 담당자',
    'TE_O': 'O(OVL) 담당자',
    'TE_E': 'E(MASK) 담당자·검토자(EV)',
    'MASTER': '관리자 권한 케이스',
}


class Combo:
    """상신 1건에 필요한 마스터 데이터 한 벌 (전부 실제 DB 값)."""

    def __init__(self, line, process, product, process_id, layer_rows, ovl_rows=None):
        self.line = line
        self.process = process
        self.product = product
        self.process_id = process_id
        self.layer_rows = layer_rows
        self.ovl_rows = ovl_rows or []

    @property
    def has_plel(self):
        return any(VALIDATION_KEYWORD in (r.get('recipeid') or '').lower() for r in self.layer_rows)

    def __repr__(self):
        return (f'<Combo {self.line}/{self.process}/{self.product}/{self.process_id} '
                f'rows={len(self.layer_rows)} plel={self.has_plel}>')


class MasterData:
    """개발 DB 탐색 결과 캐시."""

    def __init__(self, api, token=None, scan_limit=8, log=print):
        self.api = api
        self.token = token
        self.scan_limit = scan_limit
        self.log = log
        self.users_by_role = {}
        self.combos = []          # 발견한 Combo 전부
        self.combo_plel = None    # plel 이 있는 조합(E 단계 생성용)
        self.combo_plain = None   # plel 이 없는 조합(E 단계 제외용)

    # ----- 사용자 -----
    def load_users(self):
        for role in REQUIRED_ROLES:
            res = self.api.get('/api/users/', params={'role': role}, token=self.token)
            users = as_list(res.body) if res.ok else []
            self.users_by_role[role] = [
                {'loginid': u.get('loginid') or u.get('username'),
                 'name': u.get('username') or u.get('display_name') or '',
                 'mail': u.get('mail') or ''}
                for u in users if (u.get('loginid') or u.get('username'))
            ]
        return self.users_by_role

    def users(self, role, count=1):
        """역할별 사용자 count 명. 부족하면 짧은 리스트를 그대로 돌려준다(호출부가 SKIP 판정)."""
        return self.users_by_role.get(role, [])[:count]

    def missing_roles(self, needed):
        """needed = {'TE_E': 2} 형태 → 인원이 모자란 역할 목록."""
        short = []
        for role, n in needed.items():
            if len(self.users_by_role.get(role, [])) < n:
                short.append(f'{role} {n}명 필요(현재 {len(self.users_by_role.get(role, []))}명)')
        return short

    # ----- 마스터 데이터 -----
    def load_combos(self):
        """화면과 같은 순서로 옵션을 좁혀 가며 실제로 존재하는 조합을 찾는다."""
        lines = as_list(self.api.get('/api/lines/', token=self.token).body)
        line_names = [l.get('name') for l in lines if l.get('name')]
        if not line_names:
            return []

        for line in line_names[:self.scan_limit]:
            processes = self._options('/api/form-options/processes/', {'line': line})
            for process in processes[:self.scan_limit]:
                products = self._options('/api/form-options/products/',
                                         {'line': line, 'process': process})
                for product in products[:self.scan_limit]:
                    pids = self._options('/api/form-options/process-id/',
                                         {'line': line, 'product': product})
                    for pid in pids[:self.scan_limit]:
                        rows = self._options('/api/form-options/job-file-layer/',
                                             {'line': line, 'process': pid})
                        if not rows:
                            continue
                        ovl = self._options('/api/form-options/ovl-layer/',
                                            {'line': line, 'process': pid})
                        combo = Combo(line, process, product, pid, rows, ovl)
                        self.combos.append(combo)
                        if combo.has_plel and self.combo_plel is None:
                            self.combo_plel = combo
                        if not combo.has_plel and self.combo_plain is None:
                            self.combo_plain = combo
                        if self.combo_plel and self.combo_plain:
                            return self.combos
        return self.combos

    def _options(self, path, params):
        res = self.api.get(path, params=params, token=self.token)
        if not res.ok or not isinstance(res.body, dict):
            return []
        return res.body.get('options') or []

    def pick(self, plel=False):
        """조합 선택. plel=True 인데 DB 에 plel 행이 없으면 None 을 돌려준다(케이스 SKIP)."""
        if plel:
            return self.combo_plel
        return self.combo_plain or self.combo_plel

    def summary(self):
        lines = ['[마스터 데이터]']
        for c in (self.combo_plain, self.combo_plel):
            if c:
                lines.append(f'  {c}')
        if not self.combo_plel:
            lines.append(f'  ⚠️ pp 에 {VALIDATION_KEYWORD!r} 이 있는 조합을 찾지 못했다 '
                         f'— E(MASK) 단계가 필요한 케이스는 SKIP 된다.')
        lines.append('[사용자]')
        for role in REQUIRED_ROLES:
            found = self.users_by_role.get(role, [])
            names = ', '.join(u['loginid'] for u in found[:4])
            lines.append(f'  {role}: {len(found)}명 {("(" + names + ")") if names else ""}')
        return '\n'.join(lines)
