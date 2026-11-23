// claude 수정 (2026-11-20): 렌더 정화(B-26) 회귀 고정 — 공격 페이로드 제거 + 에디터 서식 보존
import { sanitizeRichHtml } from './sanitizeRichHtml';

/** 정화 결과를 실제 DOM 으로 만들어 위험 요소를 구조적으로 검사한다(문자열 비교만으로는 놓칠 수 있다). */
const toDom = (html: string): HTMLDivElement => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};

const hasEventHandlerAttr = (root: HTMLElement): boolean =>
  Array.from(root.querySelectorAll('*')).some((el) =>
    Array.from(el.attributes).some((a) => a.name.toLowerCase().startsWith('on')),
  );

describe('sanitizeRichHtml — 공격 페이로드 제거', () => {
  const PAYLOADS: Record<string, string> = {
    img_onerror: '<img src=x onerror="alert(1)">',
    script: '<p>hi</p><script>alert(1)</script>',
    svg_onload: '<svg onload=alert(1)></svg><p>t</p>',
    iframe: '<iframe src="javascript:alert(1)"></iframe>',
    p_onclick: '<p onclick="alert(1)">c</p>',
    video_onplay: '<video src="/media/a.mp4" onplay="alert(1)"></video>',
    style_tag: '<style>body{display:none}</style><p>x</p>',
    form: '<form action="https://evil.example"><input name=p></form><p>y</p>',
    object: '<object data="javascript:alert(1)"></object><embed src="x">',
  };

  it.each(Object.entries(PAYLOADS))('%s: 스크립트·이벤트 핸들러·위험 태그가 남지 않는다', (_name, payload) => {
    const dom = toDom(sanitizeRichHtml(payload));
    expect(dom.querySelector('script, style, iframe, svg, object, embed, form, input')).toBeNull();
    expect(hasEventHandlerAttr(dom)).toBe(false);
  });

  it('javascript: 링크는 href 째 제거되고 글자만 남는다(엔티티 우회 포함)', () => {
    for (const href of ['javascript:alert(1)', 'jav&#x09;ascript:alert(1)', ' JAVASCRIPT:alert(1)']) {
      const dom = toDom(sanitizeRichHtml(`<p><a href="${href}">x</a></p>`));
      expect(dom.querySelector('a')).toBeNull();
      expect(dom.textContent).toBe('x');
    }
  });

  it('스키마에 없는 style 속성(background-image 등)은 버린다', () => {
    const out = sanitizeRichHtml('<p><span style="color: red; background-image:url(https://evil.example/x)">s</span></p>');
    expect(out).not.toContain('background-image');
    expect(out).toContain('color: red');
  });

  it('빈 값은 빈 문자열', () => {
    expect(sanitizeRichHtml('')).toBe('');
    expect(sanitizeRichHtml(null)).toBe('');
    expect(sanitizeRichHtml(undefined)).toBe('');
  });
});

describe('sanitizeRichHtml — 에디터 서식 보존', () => {
  it('제목·정렬·굵게·기울임·밑줄·취소선·색·글자 크기·글꼴·목록·인용·코드·구분선이 유지된다', () => {
    const out = sanitizeRichHtml(
      '<h2 style="text-align: center">T</h2>'
      + '<p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> '
      + '<span style="color: rgb(255, 0, 0); font-size: 18px; font-family: Arial">c</span></p>'
      + '<ul><li><p>l</p></li></ul><blockquote><p>q</p></blockquote><pre><code>x</code></pre><hr>',
    );
    const dom = toDom(out);
    expect(dom.querySelector('h2')?.getAttribute('style')).toContain('text-align: center');
    expect(dom.querySelector('strong')).not.toBeNull();
    expect(dom.querySelector('em')).not.toBeNull();
    expect(dom.querySelector('u')).not.toBeNull();
    expect(dom.querySelector('s')).not.toBeNull();
    const spanStyle = dom.querySelector('span')?.getAttribute('style') ?? '';
    expect(spanStyle).toContain('color: rgb(255, 0, 0)');
    expect(spanStyle).toContain('font-size: 18px');
    expect(spanStyle).toContain('font-family: Arial');
    expect(dom.querySelector('ul li')).not.toBeNull();
    expect(dom.querySelector('blockquote')).not.toBeNull();
    expect(dom.querySelector('pre code')).not.toBeNull();
    expect(dom.querySelector('hr')).not.toBeNull();
  });

  it('업로드 이미지·동영상과 http(s) 링크가 유지된다', () => {
    const dom = toDom(sanitizeRichHtml(
      '<img src="/media/a.png"><video src="/media/a.mp4" controls="controls"></video>'
      + '<p><a href="https://example.com" target="_blank">ok</a></p>',
    ));
    expect(dom.querySelector('img')?.getAttribute('src')).toBe('/media/a.png');
    expect(dom.querySelector('video')?.getAttribute('src')).toBe('/media/a.mp4');
    expect(dom.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('표(머리글·본문 셀)가 유지된다', () => {
    const dom = toDom(sanitizeRichHtml(
      '<table><tbody><tr><th><p>h</p></th></tr><tr><td><p>d</p></td></tr></tbody></table>',
    ));
    expect(dom.querySelector('table th')?.textContent).toBe('h');
    expect(dom.querySelector('table td')?.textContent).toBe('d');
  });

  it('저장 형식의 빈 줄(<p><br></p>)이 유지된다', () => {
    expect(sanitizeRichHtml('<p>a</p><p><br></p><p>b</p>')).toBe('<p>a</p><p><br></p><p>b</p>');
  });
});

// claude 수정 (2026-11-23): VOC @멘션 노드가 렌더 정화를 통과해 서버가 읽는 data-id 와 칩 표시가 유지되는지 고정
describe('sanitizeRichHtml — @멘션', () => {
  it('멘션 span 의 data-type·data-id·data-label 과 칩 클래스가 유지된다', () => {
    const dom = toDom(sanitizeRichHtml(
      '<p><span data-type="mention" data-id="team:TE_R" data-label="AGENT R팀" data-mention-suggestion-char="@">@AGENT R팀</span> 확인 부탁</p>',
    ));
    const mention = dom.querySelector('span[data-type="mention"]');
    expect(mention?.getAttribute('data-id')).toBe('team:TE_R');
    expect(mention?.getAttribute('data-label')).toBe('AGENT R팀');
    expect(mention?.classList.contains('mention')).toBe(true);
    expect(mention?.textContent).toBe('@AGENT R팀');
  });

  it('멘션 span 에 붙인 이벤트 핸들러·style 은 버린다', () => {
    const dom = toDom(sanitizeRichHtml(
      '<p><span data-type="mention" data-id="user:kim" data-label="김" onclick="alert(1)" style="background-image:url(x)">@김</span></p>',
    ));
    expect(hasEventHandlerAttr(dom)).toBe(false);
    expect(dom.innerHTML).not.toContain('background-image');
    expect(dom.querySelector('span[data-type="mention"]')?.getAttribute('data-id')).toBe('user:kim');
  });
});
