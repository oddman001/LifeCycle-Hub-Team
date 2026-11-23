// Local-edition accounts for the Windows app.
//
// The cloud demo gate (demo-auth.mjs) exists so invited testers get isolated workspaces.
// This local gate is different on purpose:
//   * it is enabled by default in the packaged app; set LOCAL_ACCOUNTS=off to restore the
//     old account-free local mode (the tests pass LOCAL_ACCOUNTS=off explicitly);
//   * it serves http://127.0.0.1, so the cookie cannot be a `__Host-`/`Secure` cookie;
//   * every account on this machine shares one data directory. Sharing is deliberate: the
//     existing local database keeps working, and the account is a login identity rather than
//     a data boundary. The cloud demo remains the per-account isolation story.
const localCookieName = "lifecycle_local";
const localSessionAge = 60 * 60 * 24 * 7;
const localPasswordMin = 8;
const localPasswordHint = "至少 8 位，并同时包含大写字母、小写字母和数字。";
const localUsernameHint = "3–32 位，可用英文字母、数字、点、短横线或下划线；不能与已有账号重复。";

// Registration and password changes share one rule set: length plus mixed case and a digit.
// Login is deliberately not re-validated, so an older password still signs in.
function localPasswordProblem(value, label = "密码") {
  if ([...value].length < localPasswordMin) return `${label}需至少 ${localPasswordMin} 位，并同时包含大写字母、小写字母和数字。`;
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) return `${label}需同时包含大写字母、小写字母和数字。`;
  return "";
}

function localResponse(content, status = 200) { return demoResponse(content, status); }

function localRedirect(path, token) {
  const headers = new Headers({ location: path, "cache-control": "no-store" });
  if (token !== undefined) headers.set("set-cookie", localCookieName + "=" + token +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + (token ? localSessionAge : 0));
  return new Response(null, { status: 303, headers });
}

async function localAccountCount(db) {
  const row = await db.prepare("SELECT count(*) AS total FROM LocalAccount").first();
  return Number(row?.total || 0);
}

function localDate(unix) {
  if (!unix) return "—";
  const date = new Date(Number(unix) * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The account bar repeats the signed-in identity on every business page: who this computer
// thinks you are, when the account was created, and a direct way out.
function localAccountBar(session) {
  const initial = [...String(session.username || "?")][0]?.toUpperCase() ?? "?";
  return `<section class="account-bar" aria-label="账户信息">
    <span class="account-avatar" aria-hidden="true">${escape(initial)}</span>
    <div class="account-identity">
      <strong>${escape(session.username)}</strong>
      <span>本机账号 · 注册于 ${localDate(session.createdAt)} · 数据保存在这台电脑</span>
    </div>
    <div class="account-actions">
      <a class="account-link" href="/account">个人信息</a>
      <form method="post" action="/logout"><button class="account-exit" type="submit">退出登录</button></form>
    </div>
  </section>`;
}

async function localSession(request, db) {
  const cookies = (request.headers.get("cookie") || "").split(";").map((value) => value.trim());
  const token = cookies.find((value) => value.startsWith(localCookieName + "="))?.slice(localCookieName.length + 1);
  if (!/^[0-9a-f]{64}$/.test(token ?? "")) return null;
  return await db.prepare(`SELECT a.id,a.username,a.passwordVersion,a.createdAt,s.tokenHash
    FROM LocalSession s JOIN LocalAccount a ON a.id=s.accountId
    WHERE s.tokenHash=? AND s.expiresAt>? AND a.passwordVersion=s.passwordVersion`)
    .bind(await demoDigest(token), demoNow()).first();
}

async function localIssueSession(db, account) {
  const token = demoRandom(32);
  await db.batch([
    db.prepare("DELETE FROM LocalSession WHERE expiresAt<=?").bind(demoNow()),
    db.prepare("INSERT INTO LocalSession(tokenHash,accountId,passwordVersion,expiresAt) VALUES(?,?,?,?)")
      .bind(await demoDigest(token), account.id, account.passwordVersion, demoNow() + localSessionAge),
  ]);
  return localRedirect("/", token);
}

async function localLimit(db, request, action, username) {
  const window = Math.floor(demoNow() / 600);
  const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local";
  const [ip, account] = await Promise.all([
    demoDigest(action + ":ip:" + clientIp), demoDigest(action + ":account:" + username),
  ]);
  const count = (key, max) => db.prepare(`INSERT INTO LocalAuthAttempt(key,window,hits) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN window=excluded.window THEN min(hits+1,?) ELSE 1 END,
    window=excluded.window RETURNING hits`).bind(key, window, max + 1);
  const [, fromIp, fromAccount] = await db.batch([
    db.prepare("DELETE FROM LocalAuthAttempt WHERE window<?").bind(window - 1),
    count(ip, 25), count(account, 8),
  ]);
  return fromIp.results[0].hits <= 25 && fromAccount.results[0].hits <= 8;
}

const localField = ({ label, name, type, autocomplete, max = 128, autofocus = false, hint = "", extra = "" }) =>
  `<label class="auth-field"><span class="auth-label">${label}</span>
    <input name="${name}" type="${type}" autocomplete="${autocomplete}" maxlength="${max}"${autofocus ? " autofocus" : ""}${extra} required>
    ${hint ? `<span class="auth-hint">${hint}</span>` : ""}</label>`;
const localError = (message) => message ? `<p class="auth-error" role="alert">${escape(message)}</p>` : "";
const localPasswordRules = `<span class="auth-rules"><span class="auth-rule">至少 8 位</span><span class="auth-rule">大写字母</span><span class="auth-rule">小写字母</span><span class="auth-rule">数字</span></span>`;

function localCredentialsPage(register, message = "", status = 200, firstRun = false) {
  const action = register ? "/register" : "/login";
  const title = register ? "从今天起，把日常收好" : "欢迎回来";
  const intro = register
    ? "在这台电脑上留一个名字，让食品、药品、衣物、设备与订阅，都有迹可循。"
    : "输入本机账号，继续打理这些细小的日子。";
  const notice = firstRun
    ? '<p class="auth-note">本机还没有账号。创建后即可进入，数据继续保存在本机。</p>' : "";
  return localResponse(`<section class="auth-page">
    <p class="auth-kicker">LifeCycle Hub · 本机账号</p>
    <h1 class="auth-title">${title}</h1>
    <p class="auth-intro">${escape(intro)}</p>
    <div class="auth-card">${notice}${localError(message)}
      <form method="post" action="${action}" class="auth-form">
        ${localField({ label: "用户名", name: "username", type: "text", autocomplete: "username", max: 32, autofocus: true, hint: register ? localUsernameHint : "", extra: ' autocapitalize="none" spellcheck="false"' })}
        ${localField({ label: "密码", name: "password", type: "password", autocomplete: register ? "new-password" : "current-password", hint: register ? localPasswordRules : "" })}
        ${register ? localField({ label: "确认密码", name: "confirm", type: "password", autocomplete: "new-password", hint: "与上面输入保持一致。" }) : ""}
        <button class="auth-submit" type="submit">${register ? "创建并进入" : "登录"}</button>
      </form>
      <p class="auth-switch">${register ? link("/login", "已经有账号？去登录") : link("/register", "还没有账号？创建一个")}</p>
      <p class="auth-foot">本机所有账号共用同一份数据；账号只用来确认“是谁在用这台电脑”，不做数据隔离。</p>
    </div>
    <p class="auth-quote">东西有来处，日子有归期。</p>
  </section>`, status);
}

function localAccountPage(account, message = "", status = 200) {
  return localResponse(`<section class="auth-page">
    <p class="auth-kicker">LifeCycle Hub · 本机账号</p>
    <h1 class="auth-title">我的账号</h1>
    <p class="auth-intro">已登录为 <strong>${escape(account.username)}</strong>。数据保存在这台电脑上，由本机所有账号共用。</p>
    <dl class="account-profile">
      <div><dt>用户名</dt><dd>${escape(account.username)}</dd></div>
      <div><dt>注册时间</dt><dd>${localDate(account.createdAt)}</dd></div>
      <div><dt>数据位置</dt><dd>这台电脑的本机数据库</dd></div>
    </dl>
    <div class="auth-card">${localError(message)}
      <form action="/account/password" method="post" class="auth-form">
        ${localField({ label: "当前密码", name: "password", type: "password", autocomplete: "current-password" })}
        ${localField({ label: "新密码", name: "newPassword", type: "password", autocomplete: "new-password", hint: localPasswordRules })}
        ${localField({ label: "确认新密码", name: "confirm", type: "password", autocomplete: "new-password", hint: "与上面输入保持一致。" })}
        <button class="auth-submit" type="submit">修改密码</button>
      </form>
      <form action="/logout" method="post" class="auth-logout"><button class="button secondary" type="submit">退出登录</button></form>
      <p class="auth-foot">想暂时关闭登录验证，可在 .env 里设置 LOCAL_ACCOUNTS=off 后重启。</p>
    </div>
  </section>`, status);
}

// Validate and split a credentials form. Returns {error, status} or the parsed values.
async function localForm(request) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
    return { error: "表单格式无效。", status: 415 };
  if (Number(request.headers.get("content-length")) > 4096) return { error: "表单过大。", status: 413 };
  try {
    return { form: await request.formData() };
  } catch {
    console.warn("local_auth.form_invalid", request.url);
    return { error: "无法读取表单，请刷新后重新输入。", status: 400 };
  }
}

async function localAuthRoute(request, env, url) {
  const db = env.DB, path = url.pathname, isPost = request.method === "POST";
  const origin = request.headers.get("origin");
  // Pages are served with Referrer-Policy: no-referrer, so browsers may redact Origin
  // ("null") or drop it entirely on a same-origin form navigation.
  const embeddedSameOrigin = (origin === null || origin === "null") && request.headers.get("sec-fetch-site") === "same-origin";
  if (isPost && origin !== url.origin && !embeddedSameOrigin) {
    return localResponse(hero("请求来源无效", ""), 403);
  }
  const session = await localSession(request, db);
  const accountRoute = ["/account", "/account/password", "/logout"].includes(path);
  if (accountRoute && !session) return isPost ? localResponse(hero("请先登录", ""), 401) : localRedirect("/login");
  if (path === "/account" && !isPost) return localAccountPage(session);
  if (path === "/logout" && !isPost) return localResponse(hero("请求方法不支持", ""), 405);
  if (path === "/logout") {
    await db.prepare("DELETE FROM LocalSession WHERE tokenHash=?").bind(session.tokenHash).run();
    return localRedirect("/login", "");
  }
  const registration = path === "/register";
  const credentials = registration || path === "/login";
  const passwordChange = path === "/account/password" && isPost;
  if (credentials && !isPost) {
    if (session) return localRedirect("/account");
    if (!registration && !await localAccountCount(db)) return localRedirect("/register");
    return localCredentialsPage(registration, "", 200, !await localAccountCount(db));
  }
  if (!credentials && !passwordChange) {
    if (!session) return await localAccountCount(db) ? localRedirect("/login") : localRedirect("/register");
    return localBusiness(request, env, url, session);
  }
  const parsed = await localForm(request);
  if (parsed.error) return passwordChange ? localAccountPage(session, parsed.error, parsed.status)
    : localCredentialsPage(registration, parsed.error, parsed.status);
  const { form } = parsed;
  const reject = (message, status) => passwordChange
    ? localAccountPage(session, message, status) : localCredentialsPage(registration, message, status);
  const usernameInput = form.get("username");
  const username = passwordChange ? session.username
    : String(usernameInput ?? "").normalize("NFKC").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!passwordChange && !form.has("username")) {
    console.warn("local_auth.field_missing", path, "username");
    return reject("服务端未收到用户名，请刷新后重新提交。", 400);
  }
  if (!username) return reject("用户名字段为空，请手动输入用户名。", 400);
  if (username.length < 3 || username.length > 32) return reject("用户名长度须为 3–32 个字符。", 400);
  if (!/^[a-z0-9]/.test(username)) return reject("用户名第一个字符须是英文字母或数字。", 400);
  if (!/^[a-z0-9_.-]+$/.test(username)) return reject("用户名含有不支持的字符。请手动输入英文字母、数字、点、短横线或下划线。", 400);
  if (!password) return reject("服务端未收到密码，请重新输入密码后提交。", 400);
  if (demoEncoder.encode(password).length > 512) return reject("密码超过允许长度。", 400);
  if (!await localLimit(db, request, path, username)) return reject("请求过于频繁，请稍后重试。", 429);
  const confirm = form.has("confirm") ? String(form.get("confirm") ?? "") : null;
  if (registration) {
    const problem = localPasswordProblem(password);
    if (problem) return reject(problem, 400);
    if (confirm !== password) return reject("两次输入的密码不一致。", 400);
    const account = { id: crypto.randomUUID(), passwordVersion: 1 };
    const result = await db.prepare("INSERT OR IGNORE INTO LocalAccount(id,username,passwordHash,createdAt) VALUES(?,?,?,?)")
      .bind(account.id, username, demoPasswordHash(password), demoNow()).run();
    if (!result.meta.changes) return reject("用户名已被使用，请换一个或直接登录。", 400);
    return localIssueSession(db, account);
  }
  // A password change verifies the signed-in account, so its hash has to be re-read by id:
  // localSession() deliberately returns only the identity fields the page needs.
  const account = await db.prepare(
    "SELECT id,username,passwordHash,passwordVersion FROM LocalAccount WHERE " + (passwordChange ? "id=?" : "username=?"))
    .bind(passwordChange ? session.id : username).first();
  if (!demoCheckPassword(password, account?.passwordHash)) return reject("用户名或密码错误。", 401);
  if (!passwordChange) return localIssueSession(db, account);
  const next = String(form.get("newPassword") ?? "");
  if (demoEncoder.encode(next).length > 512) return reject("新密码超过允许长度。", 400);
  const nextProblem = localPasswordProblem(next, "新密码");
  if (nextProblem) return reject(nextProblem, 400);
  if (confirm !== next) return reject("两次输入的新密码不一致。", 400);
  const result = await db.prepare(`UPDATE LocalAccount SET passwordHash=?,passwordVersion=passwordVersion+1
    WHERE id=? AND passwordVersion=?`).bind(demoPasswordHash(next), account.id, account.passwordVersion).run();
  if (!result.meta.changes) return localRedirect("/login", "");
  return localIssueSession(db, { ...account, passwordVersion: account.passwordVersion + 1 });
}

async function localBusiness(request, env, url, session) {
  const headers = new Headers(request.headers);
  headers.set("oai-authenticated-user-id", "local-device");
  // Business routes check the canonical origin after the gate approves the POST.
  if (request.method === "POST") headers.set("origin", url.origin);
  const response = await businessRoute(new Request(request, { headers }), env, url, "local-device");
  response.headers.set("Cache-Control", "no-store");
  if (response.headers.get("content-type")?.includes("text/html")) {
    const html = (await response.text())
      .replace("</nav>", `<a href="/account">我的账号 · ${escape(session.username)}</a></nav>`)
      .replace('<main id="main-content" tabindex="-1">',
        `<main id="main-content" tabindex="-1">${localAccountBar(session)}`);
    return new Response(html, { status: response.status, headers: response.headers });
  }
  return response;
}
