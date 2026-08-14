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

# 개발용 계정의 메일 도메인. `python manage.py create_users` 로 만드는 시드 계정
# (pl_user*, agent_r*, agent_p*, agent_j*, agent_o*, agent_e*, master)이 전부 이 도메인이다.
# 러너는 **이 도메인 계정만** 골라 상신·결재한다 — 실사용자 계정으로 문서를 만들지 않기 위해서다.
DEV_MAIL_DOMAIN = '@company.com'

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

    def __init__(self, api, token=None, scan_limit=8, log=print,
                 mail_domain=DEV_MAIL_DOMAIN, allow_any_account=False):
        self.api = api
        self.token = token
        self.scan_limit = scan_limit
        self.log = log
        self.mail_domain = (mail_domain or '').lower()
        self.allow_any_account = allow_any_account
        self.users_by_role = {}
        self.excluded_by_domain = {}  # 역할 → 도메인이 달라 제외한 인원 수
        self.combos = []          # 발견한 Combo 전부
        self.combo_plel = None    # plel 이 있는 조합(E 단계 생성용)
        self.combo_plain = None   # plel 이 없는 조합(E 단계 제외용)

    # ----- 사용자 -----
    def load_users(self):
        """역할별 **개발용 계정**(메일이 `mail_domain` 인 계정)만 골라 담는다.

        `--allow-any-account` 를 주면 도메인 필터를 끄지만, 기본은 개발용 계정 전용이다 —
        러너가 만드는 의뢰서·결재 이력이 실사용자 이름으로 남지 않게 하기 위해서다.
        """
        for role in REQUIRED_ROLES:
            res = self.api.get('/api/users/', params={'role': role}, token=self.token)
            raw = as_list(res.body) if res.ok else []
            parsed = [
                {'loginid': u.get('loginid') or u.get('username'),
                 'name': u.get('name') or u.get('username') or '',
                 'mail': u.get('mail') or '',
                 'deptname': u.get('deptname') or ''}
                for u in raw if (u.get('loginid') or u.get('username'))
            ]
            if self.mail_domain and not self.allow_any_account:
                dev_users = [u for u in parsed if u['mail'].lower().endswith(self.mail_domain)]
                self.excluded_by_domain[role] = len(parsed) - len(dev_users)
                parsed = dev_users
            self.users_by_role[role] = parsed
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
        scope = ('전체 계정(도메인 필터 해제)' if self.allow_any_account
                 else f'개발용 계정만({self.mail_domain})')
        lines.append(f'[사용자] {scope}')
        for role in REQUIRED_ROLES:
            found = self.users_by_role.get(role, [])
            names = ', '.join(u['loginid'] for u in found[:4])
            skipped = self.excluded_by_domain.get(role, 0)
            note = f' / 도메인 불일치로 제외 {skipped}명' if skipped else ''
            lines.append(f'  {role}: {len(found)}명 {("(" + names + ")") if names else ""}{note}')
        if not self.allow_any_account and not any(self.users_by_role.values()):
            lines.append(f'  ⚠️ {self.mail_domain} 계정이 하나도 없다 — '
                         '`python manage.py create_users` 로 개발 계정을 만들거나 '
                         '`--mail-domain` / `--allow-any-account` 를 지정한다.')
        return '\n'.join(lines)
