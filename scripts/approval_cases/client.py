"""개발환경 HTTP 클라이언트 — dev-login 으로 역할별 토큰을 받아 API 를 호출한다.

의존성 없이 표준 라이브러리(urllib)만 쓴다. 개발환경(AUTH_MODE=dev)에서만 동작하며,
운영(AUTH_MODE=sso)에서는 dev-login 이 403 을 돌려주므로 러너 자체가 시작되지 않는다.
"""

import json
import urllib.error
import urllib.parse
import urllib.request

# API 응답이 페이지네이션(dict) 인지 목록(list) 인지 구분하는 키
PAGINATED_KEY = 'results'

DEFAULT_TIMEOUT = 30


class ApiError(Exception):
    """예상하지 못한 통신 실패(네트워크·JSON 파싱). HTTP 4xx/5xx 는 예외가 아니라 Response 로 돌려준다."""


class Response:
    """HTTP 응답 한 건. status 로 판정하고 body 로 내용을 본다."""

    def __init__(self, status, body, raw=''):
        self.status = status
        self.body = body
        self.raw = raw

    @property
    def ok(self):
        return 200 <= self.status < 300

    def error_text(self):
        if isinstance(self.body, dict):
            return str(self.body.get('error') or self.body)
        return str(self.body or self.raw)

    def __repr__(self):
        return f'<Response {self.status} {str(self.body)[:120]}>'


class Api:
    """base_url 하나에 붙는 저수준 클라이언트."""

    def __init__(self, base_url, timeout=DEFAULT_TIMEOUT, verbose=False):
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.verbose = verbose

    def request(self, method, path, data=None, params=None, token=None):
        url = f'{self.base_url}{path}'
        if params:
            url = f'{url}?{urllib.parse.urlencode(params)}'
        payload = None
        headers = {'Accept': 'application/json'}
        if data is not None:
            payload = json.dumps(data).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        if token:
            headers['Authorization'] = f'Bearer {token}'

        req = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode('utf-8', 'replace')
                return Response(resp.status, _parse(raw), raw)
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', 'replace')
            return Response(e.code, _parse(raw), raw)
        except urllib.error.URLError as e:
            raise ApiError(f'{method} {url} 실패: {e.reason}') from e

    def get(self, path, params=None, token=None):
        return self.request('GET', path, params=params, token=token)

    def post(self, path, data=None, token=None):
        return self.request('POST', path, data=data, token=token)

    def patch(self, path, data=None, token=None):
        return self.request('PATCH', path, data=data, token=token)


def _parse(raw):
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return raw


def as_list(body):
    """페이지네이션 응답(dict)과 목록 응답(list)을 모두 리스트로 정규화한다."""
    if isinstance(body, dict):
        return body.get(PAGINATED_KEY) or []
    return body or []


class Actor:
    """특정 사용자로 로그인한 세션. 케이스는 항상 이 단위로 API 를 호출한다."""

    def __init__(self, api, loginid, role='', name='', mail='', deptname=''):
        self.api = api
        self.loginid = loginid
        self.role = role
        self.name = name or loginid
        self.mail = mail
        self.deptname = deptname
        self._token = None

    def login(self):
        res = self.api.post('/api/auth/dev-login/', {'username': self.loginid})
        if not res.ok:
            raise ApiError(f'dev-login 실패({self.loginid}): {res.status} {res.error_text()}')
        self._token = res.body.get('access')
        user = res.body.get('user') or {}
        # dev-login 응답은 auth_views.user_to_dict 형식이다:
        # {id, username(=loginid), name, role, department, email}
        self.role = user.get('role', self.role)
        self.name = user.get('name') or self.name
        self.mail = user.get('email') or self.mail
        self.deptname = user.get('department') or self.deptname
        return self

    @property
    def token(self):
        if self._token is None:
            self.login()
        return self._token

    def get(self, path, params=None):
        return self.api.get(path, params=params, token=self.token)

    def post(self, path, data=None):
        return self.api.post(path, data=data, token=self.token)

    def patch(self, path, data=None):
        return self.api.patch(path, data=data, token=self.token)

    def __repr__(self):
        return f'<Actor {self.loginid}({self.role})>'
