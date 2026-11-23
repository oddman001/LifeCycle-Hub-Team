import assert from "node:assert/strict";
import { openDemoDatabase } from "./standalone-db.mjs";
import worker from "./dist/server/index.js";

// Local registration and login. The gate is opt-in (LOCAL_ACCOUNTS=on) and every account on
// this machine shares the same data, which is what keeps existing local databases working.
const d = openDemoDatabase(":memory:");
const origin = "http://localhost";
const env = { DB: d.DB, LOCAL_INSTANCE: true, LOCAL_DEMO_SEED: true, LOCAL_ACCOUNTS: "on" };
const get = (path, cookie) => worker.fetch(new Request(origin + path, cookie ? { headers: { cookie } } : {}), env);
const post = (path, data, cookie) => worker.fetch(new Request(origin + path, {
  method: "POST",
  headers: { origin, ...(cookie ? { cookie } : {}) },
  body: new URLSearchParams(data),
}), env);
const sessionCookie = (response) => {
  const header = response.headers.get("set-cookie");
  assert.ok(header, "expected a session cookie");
  return header.split(";")[0];
};
const credentials = { username: "owner", password: "LocalPass1", confirm: "LocalPass1" };

// 1. First run: no accounts yet, so the app sends people to the registration form.
const firstRun = await get("/");
assert.equal(firstRun.status, 303);
assert.equal(firstRun.headers.get("location"), "/register");
const loginWithoutAccounts = await get("/login");
assert.equal(loginWithoutAccounts.headers.get("location"), "/register");
const registerPage = await get("/register");
assert.equal(registerPage.status, 200);
const registerHtml = await registerPage.text();
assert.match(registerHtml, /创建并进入/);
assert.match(registerHtml, /本机还没有账号/);
assert.match(registerHtml, /本机所有账号共用同一份数据/);
// The page has to state the password rule and the uniqueness rule up front.
assert.match(registerHtml, /至少 8 位/);
assert.match(registerHtml, /大写字母/);
assert.match(registerHtml, /小写字母/);
assert.match(registerHtml, /数字/);
assert.match(registerHtml, /不能与已有账号重复/);

// 2. Registering signs the account in with a non-Secure, HttpOnly local cookie.
const created = await post("/register", credentials);
assert.equal(created.status, 303);
assert.equal(created.headers.get("location"), "/");
const setCookie = created.headers.get("set-cookie");
assert.match(setCookie, /^lifecycle_local=[0-9a-f]{64}/);
assert.match(setCookie, /HttpOnly/);
assert.match(setCookie, /SameSite=Lax/);
assert.match(setCookie, /Path=\//);
assert.doesNotMatch(setCookie, /Secure/, "the local app is served over http://127.0.0.1");
const cookie = sessionCookie(created);

const home = await get("/", cookie);
assert.equal(home.status, 200);
const homeHtml = await home.text();
assert.match(homeHtml, /我的账号 · owner/);
assert.match(homeHtml, /总览/);
assert.match(homeHtml, /class="account-bar"/);
assert.match(homeHtml, /个人信息/);
assert.match(homeHtml, /action="\/logout"/);
assert.match(homeHtml, /退出登录/);
assert.match(homeHtml, /注册于 \d{4}-\d{2}-\d{2}/);
assert.ok((await d.DB.prepare("SELECT count(*) AS n FROM Item").first()).n > 0, "shared local data is seeded");
const account = await get("/account", cookie);
assert.equal(account.status, 200);
const accountHtml = await account.text();
assert.match(accountHtml, /修改密码/);
assert.match(accountHtml, /class="account-profile"/);
assert.match(accountHtml, /注册时间/);
assert.match(accountHtml, /数据位置/);

// The gate must not disturb the five module pages it protects.
for (const path of ["/items/food", "/items/medicine", "/items/clothing", "/items/device", "/items/subscription"]) {
  const module = await get(path, cookie);
  assert.equal(module.status, 200, path);
  const moduleHtml = await module.text();
  assert.match(moduleHtml, /我的账号 · owner/, path);
  assert.match(moduleHtml, /class="account-bar"/, path);
}

// 3. Registration validation.
const duplicate = await post("/register", { ...credentials });
assert.equal(duplicate.status, 400);
assert.match(await duplicate.text(), /用户名已被使用/);
const mismatch = await post("/register", { username: "second", password: "LocalPass2", confirm: "LocalPass3" });
assert.equal(mismatch.status, 400);
assert.match(await mismatch.text(), /不一致/);
const short = await post("/register", { username: "third", password: "Short1", confirm: "Short1" });
assert.equal(short.status, 400);
assert.match(await short.text(), /至少 8 位/);
const noUpper = await post("/register", { username: "fourth", password: "localpass1", confirm: "localpass1" });
assert.equal(noUpper.status, 400);
assert.match(await noUpper.text(), /大写字母/);
const noDigit = await post("/register", { username: "fifth", password: "LocalPass", confirm: "LocalPass" });
assert.equal(noDigit.status, 400);
assert.match(await noDigit.text(), /数字/);
const badName = await post("/register", { username: "-owner", password: "LocalPass2", confirm: "LocalPass2" });
assert.equal(badName.status, 400);
assert.match(await badName.text(), /第一个字符/);

// 4. Logout clears the cookie and the old token stops working.
const logout = await post("/logout", {}, cookie);
assert.equal(logout.status, 303);
assert.equal(logout.headers.get("location"), "/login");
assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
const afterLogout = await get("/", cookie);
assert.equal(afterLogout.status, 303);
assert.equal(afterLogout.headers.get("location"), "/login");
assert.equal((await get("/items/food", cookie)).headers.get("location"), "/login");
const loginPage = await get("/login");
assert.equal(loginPage.status, 200);
assert.doesNotMatch(await loginPage.text(), /class="account-bar"/, "the login page has no signed-in bar");
assert.equal((await get("/account")).headers.get("location"), "/login");

// 5. Login: wrong password fails, right password issues a new session, username is case-insensitive.
const wrong = await post("/login", { username: "owner", password: "nope-nope" });
assert.equal(wrong.status, 401);
assert.match(await wrong.text(), /用户名或密码错误/);
const login = await post("/login", { username: "Owner", password: credentials.password });
assert.equal(login.status, 303);
assert.equal(login.headers.get("location"), "/");
const session = sessionCookie(login);
assert.equal((await get("/", session)).status, 200);

// 6. Changing the password invalidates every older session but keeps the current one signed in.
const changed = await post("/account/password",
  { password: credentials.password, newPassword: "LocalPass2", confirm: "LocalPass2" }, session);
assert.equal(changed.status, 303);
assert.equal(changed.headers.get("location"), "/");
const next = sessionCookie(changed);
assert.notEqual(next, session);
assert.equal((await get("/", session)).status, 303);
assert.equal((await get("/", next)).status, 200);
assert.equal((await post("/login", { username: "owner", password: credentials.password })).status, 401);
assert.equal((await post("/login", { username: "owner", password: "LocalPass2" })).status, 303);

// 7. Cross-site form posts are rejected before any account work happens.
const crossSite = await worker.fetch(new Request(origin + "/login", {
  method: "POST", headers: { origin: "http://evil.example" },
  body: new URLSearchParams({ username: "owner", password: "LocalPass2" }),
}), env);
assert.equal(crossSite.status, 403);
assert.match(await crossSite.text(), /请求来源无效/);

// 7b. Pages are served with Referrer-Policy: no-referrer, so Chromium posts same-origin forms
// with "Origin: null"; that must still be accepted (real browsers hit this, fetch() doesn't).
const nullOrigin = await worker.fetch(new Request(origin + "/register", {
  method: "POST", headers: { origin: "null", "sec-fetch-site": "same-origin" },
  body: new URLSearchParams({ username: "nullorigin", password: "LocalPass3", confirm: "LocalPass3" }),
}), env);
assert.equal(nullOrigin.status, 303);
assert.equal(nullOrigin.headers.get("location"), "/");
assert.match(nullOrigin.headers.get("set-cookie") ?? "", /^lifecycle_local=/);

// 8. Repeated failures are throttled.
let limited = null;
for (let attempt = 0; attempt < 9; attempt++) {
  limited = await post("/login", { username: "throttled", password: "wrong-pass" });
}
assert.equal(limited.status, 429);
assert.match(await limited.text(), /请求过于频繁/);

// 9. Without the opt-in flag the local app keeps its fixed local-device identity.
const plain = { DB: d.DB, LOCAL_INSTANCE: true, LOCAL_DEMO_SEED: true };
const openHome = await worker.fetch(new Request(origin + "/"), plain);
assert.equal(openHome.status, 200);
assert.doesNotMatch(await openHome.text(), /我的账号/);

console.log("Local auth passed: first-run registration, login/logout, cookie flags, password change, origin check and throttling.");
d.close();
