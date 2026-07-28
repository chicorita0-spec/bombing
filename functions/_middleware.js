const COOKIE_NAME = "bombing_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24시간

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Cloudflare 변수 확인
  if (!env.SITE_PIN || !env.SESSION_SECRET) {
    return new Response(
      "Cloudflare에서 SITE_PIN과 SESSION_SECRET을 설정해 주세요.",
      {
        status: 500,
        headers: {
          "content-type": "text/plain; charset=UTF-8"
        }
      }
    );
  }

  // 정상 로그인 쿠키가 있으면 원래 페이지 표시
  const validToken = await createToken(env.SESSION_SECRET);
  const cookies = parseCookies(request.headers.get("Cookie") || "");

  if (
    cookies[COOKIE_NAME] &&
    safeEqual(cookies[COOKIE_NAME], validToken)
  ) {
    return context.next();
  }

  // 비밀번호 제출
  if (request.method === "POST") {
    const form = await request.formData();

    const pin = String(form.get("pin") || "");

    const returnTo = sanitizePath(
      String(
        form.get("returnTo") ||
        url.pathname + url.search
      )
    );

    if (pin === String(env.SITE_PIN)) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: returnTo,

          "Set-Cookie":
            `${COOKIE_NAME}=${validToken}; ` +
            `Path=/; ` +
            `Max-Age=${COOKIE_MAX_AGE}; ` +
            `HttpOnly; ` +
            `Secure; ` +
            `SameSite=Lax`
        }
      });
    }

    return renderLogin(returnTo, true);
  }

  // 로그인되지 않은 경우 잠금 화면 표시
  return renderLogin(
    url.pathname + url.search,
    false
  );
}


// 로그인 쿠키용 토큰 생성
async function createToken(secret) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode("bombing-private-site-v1")
  );

  return toBase64Url(
    new Uint8Array(signature)
  );
}


// Base64 URL 형식 변환
function toBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


// 쿠키 읽기
function parseCookies(header) {
  const result = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");

    if (index < 0) {
      continue;
    }

    const key = part
      .slice(0, index)
      .trim();

    const value = part
      .slice(index + 1)
      .trim();

    result[key] = value;
  }

  return result;
}


// 문자열 비교
function safeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);
  }

  return difference === 0;
}


// 잘못된 외부 주소 이동 방지
function sanitizePath(path) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//")
  ) {
    return "/";
  }

  return path;
}


// HTML 속성용 문자 처리
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}


// 비밀번호 입력 화면
function renderLogin(returnTo, wrongPin) {
  const errorMessage = wrongPin
    ? `
      <div class="error">
        비밀번호가 올바르지 않습니다.
      </div>
    `
    : `
      <div class="error"></div>
    `;

  const html = `
<!DOCTYPE html>
<html lang="ko">

<head>
<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1"
>

<meta
  name="theme-color"
  content="#12071e"
>

<title>BOMBING PRIVATE</title>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  font-family:
    Pretendard,
    "Noto Sans KR",
    Arial,
    sans-serif;
}

body {
  display: grid;
  place-items: center;

  padding: 20px;

  color: white;

  background:
    radial-gradient(
      circle at 50% 15%,
      rgba(255, 62, 165, 0.27),
      transparent 34%
    ),
    radial-gradient(
      circle at 15% 85%,
      rgba(130, 60, 255, 0.2),
      transparent 30%
    ),
    linear-gradient(
      145deg,
      #12071e,
      #08030d
    );
}

.login-box {
  width: min(420px, 100%);

  padding:
    34px
    28px
    27px;

  text-align: center;

  border:
    1px solid
    rgba(255, 104, 203, 0.53);

  border-radius: 26px;

  background:
    rgba(27, 12, 40, 0.94);

  box-shadow:
    0 0 40px
    rgba(255, 62, 170, 0.21),
    0 24px 70px
    rgba(0, 0, 0, 0.66);
}

.lock-icon {
  font-size: 48px;

  filter:
    drop-shadow(
      0 0 13px #ff51bd
    );
}

h1 {
  margin:
    13px
    0
    8px;

  font-size: 31px;

  text-shadow:
    0 0 15px #ff4fbf;
}

.description {
  margin:
    0
    0
    22px;

  color: #d8bfd9;

  font-size: 14px;

  line-height: 1.6;
}

.pin-input {
  width: 100%;
  height: 62px;

  text-align: center;

  border:
    1px solid
    rgba(255, 114, 206, 0.6);

  border-radius: 17px;

  outline: none;

  background: #0f0818;
  color: white;

  font-size: 28px;
  font-weight: 900;

  letter-spacing: 0.45em;
  padding-left: 0.45em;

  box-shadow:
    inset
    0 0 20px
    rgba(0, 0, 0, 0.53);
}

.pin-input:focus {
  border-color: #ff86d8;

  box-shadow:
    0 0 22px
    rgba(255, 66, 183, 0.33),
    inset
    0 0 20px
    rgba(0, 0, 0, 0.53);
}

.login-button {
  width: 100%;
  height: 55px;

  margin-top: 14px;

  border: 0;
  border-radius: 17px;

  cursor: pointer;

  color: white;

  font-size: 17px;
  font-weight: 900;

  background:
    linear-gradient(
      135deg,
      #ff258d,
      #a746ff
    );

  box-shadow:
    0 0 24px
    rgba(255, 57, 150, 0.36);
}

.login-button:hover {
  filter: brightness(1.08);
}

.error {
  height: 24px;

  margin-top: 12px;

  color: #ff89a5;

  font-size: 14px;
  font-weight: 800;
}

.hint {
  margin:
    3px
    0
    0;

  color: #9f8aa8;

  font-size: 12px;
}

</style>
</head>

<body>

<form
  class="login-box"
  method="post"
>

  <div class="lock-icon">
    🔒
  </div>

  <h1>
    BOMBING PRIVATE
  </h1>

  <p class="description">
    숫자 4자리 비밀번호를 입력해 주세요.
  </p>

  <input
    class="pin-input"
    name="pin"
    type="password"
    inputmode="numeric"
    pattern="[0-9]{4}"
    maxlength="4"
    autocomplete="off"
    autofocus
    required
    aria-label="숫자 4자리 비밀번호"
  >

  <input
    type="hidden"
    name="returnTo"
    value="${escapeHtml(returnTo)}"
  >

  <button
    class="login-button"
    type="submit"
  >
    입장하기
  </button>

  ${errorMessage}

  <div class="hint">
    숫자 입력 후 Enter 키를 눌러도 됩니다.
  </div>

</form>

</body>
</html>
`;

  return new Response(
    html,
    {
      status: wrongPin ? 401 : 200,

      headers: {
        "content-type":
          "text/html; charset=UTF-8",

        "cache-control":
          "no-store"
      }
    }
  );
}