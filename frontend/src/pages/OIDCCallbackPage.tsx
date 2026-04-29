import React, { useEffect, useState } from 'react';
import { authAPI } from '../api/client';

const OIDC_STATE_JWT_KEY = 'oidc_state_jwt';

/**
 * OIDC 콜백 페이지
 * ADFS에서 form_post로 전송된 id_token을 백엔드로 전달합니다.
 */
export default function OIDCCallbackPage(): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // form_post로 전송된 데이터 가져오기
    // hidden form에서 데이터 가져오기 (form_post 방식)
    const idTokenInput = document.getElementById('id_token') as HTMLInputElement;
    const stateInput = document.getElementById('state') as HTMLInputElement;

    const token = idTokenInput?.value;
    const stateVal = stateInput?.value;

    // nonce_jwt 가져오기 (localStorage에서)
    const nonceJwt = localStorage.getItem(OIDC_STATE_JWT_KEY) || undefined;
    if (nonceJwt) {
      console.log('[OIDCCallback] nonce_jwt 가져옴:', nonceJwt.substring(0, 50) + '...');
    } else {
      console.log('[OIDCCallback] nonce_jwt 없음');
    }

    if (!token) {
      setError('ID 토큰을 받지 못했습니다. 로그인 페이지로 이동합니다.');
      setLoading(false);
      return;
    }

    // 사용 후 localStorage에서 state_jwt 삭제
    localStorage.removeItem(OIDC_STATE_JWT_KEY);

    // 백엔드로 id_token과 nonce_jwt 전송 (CSRF 방지를 위한 JWT 검증)
    authAPI.oidcCallback({ id_token: token, state: stateVal, nonce_jwt: nonceJwt })
      .then((res) => {
        // 성공 시 메인 페이지로 리다이렉트
        // redirect_url이 있으면 해당 URL로, 없으면 메인으로
        const redirectUrl = res.redirect_url || '/';
        window.location.href = redirectUrl;
      })
      .catch((err) => {
        console.error('[OIDCCallback] Error:', err);
        setError(err instanceof Error ? err.message : '인증 처리 중 오류가 발생했습니다.');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div>인증 처리 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column' }}>
        <div style={{ color: 'red', marginBottom: '16px' }}>{error}</div>
        <button onClick={() => window.location.href = '/'}>메인으로 돌아가기</button>
      </div>
    );
  }

  return <div />;
}
