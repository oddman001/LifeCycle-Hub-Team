CREATE TABLE LocalAccount (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  passwordVersion INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE LocalSession (
  tokenHash TEXT PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES LocalAccount(id) ON DELETE CASCADE,
  passwordVersion INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX LocalSession_account ON LocalSession(accountId);
--> statement-breakpoint
CREATE INDEX LocalSession_expiry ON LocalSession(expiresAt);
--> statement-breakpoint
CREATE TABLE LocalAuthAttempt (
  key TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX LocalAuthAttempt_window ON LocalAuthAttempt(window);
