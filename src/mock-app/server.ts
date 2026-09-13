import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findMemberById,
  openSubAccount,
  searchMembers,
} from "./data.js";
import {
  FAULT_MODES,
  getGlobalFault,
  resolveFault,
  setGlobalFault,
  sleep,
  type FaultMode,
} from "./faults.js";

declare module "express-session" {
  interface SessionData {
    tellerId?: string;
    lastActivity?: number;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const TELLER_ID = "teller1";
const TELLER_PASSWORD = "password123";

export function createApp() {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: "teller-console-dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: SESSION_TIMEOUT_MS },
    })
  );

  function requireAuth(req: Request, res: Response, next: NextFunction) {
    const fault = resolveFault(req.query.inject);
    const now = Date.now();
    const expiredByFault = fault === "session_expired";
    const expiredByAge =
      req.session.lastActivity !== undefined &&
      now - req.session.lastActivity > SESSION_TIMEOUT_MS;

    if (!req.session.tellerId || expiredByFault || expiredByAge) {
      req.session.destroy(() => {});
      return res.redirect("/login?reason=session_expired");
    }
    req.session.lastActivity = now;
    next();
  }

  async function applyFaultOrNext(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const fault: FaultMode = resolveFault(req.query.inject);
    if (fault === "slow") {
      await sleep(4000);
      return next();
    }
    if (fault === "server_error") {
      return res.status(500).render("error", {
        heading: "Internal Error",
        message: "The core banking system did not respond. Try again later.",
      });
    }
    if (fault === "permission_denied") {
      return res.status(403).render("error", {
        heading: "Permission Denied",
        message: "Your teller role is not authorized for this record.",
      });
    }
    next();
  }

  app.get("/login", (req, res) => {
    res.render("login", { reason: req.query.reason });
  });

  app.post("/login", (req, res) => {
    const { username, password } = req.body as {
      username?: string;
      password?: string;
    };
    if (username === TELLER_ID && password === TELLER_PASSWORD) {
      req.session.tellerId = username;
      req.session.lastActivity = Date.now();
      return res.redirect("/");
    }
    res.redirect("/login?reason=invalid");
  });

  app.get("/logout", (req, res) => {
    req.session.destroy(() => {
      res.redirect("/login");
    });
  });

  app.get("/", requireAuth, (req, res) => {
    res.render("dashboard", { tellerId: req.session.tellerId });
  });

  app.get("/members/search", requireAuth, applyFaultOrNext, (req, res) => {
    const query = String(req.query.q ?? "");
    const fault = resolveFault(req.query.inject);
    const results = fault === "not_found" ? [] : searchMembers(query);
    res.render("search-results", { query, results });
  });

  app.get("/members/:id", requireAuth, applyFaultOrNext, (req, res) => {
    const memberId = req.params.id ?? "";
    const fault = resolveFault(req.query.inject);
    const member = fault === "not_found" ? undefined : findMemberById(memberId);
    if (!member) {
      return res.status(404).render("error", {
        heading: "Member Not Found",
        message: `No member record exists for ID ${memberId}.`,
      });
    }
    res.render("member-detail", { member });
  });

  app.get("/members/:id/panel", requireAuth, applyFaultOrNext, (req, res) => {
    const memberId = req.params.id ?? "";
    const member = findMemberById(memberId);
    if (!member) {
      return res.status(404).render("error", {
        heading: "Member Not Found",
        message: `No member record exists for ID ${memberId}.`,
      });
    }
    res.render("account-panel", { member });
  });

  app.get(
    "/members/:id/subaccounts/new",
    requireAuth,
    applyFaultOrNext,
    (req, res) => {
      const memberId = req.params.id ?? "";
      const member = findMemberById(memberId);
      if (!member) {
        return res.status(404).render("error", {
          heading: "Member Not Found",
          message: `No member record exists for ID ${memberId}.`,
        });
      }
      res.render("subaccount-new", { member });
    }
  );

  app.post(
    "/members/:id/subaccounts",
    requireAuth,
    applyFaultOrNext,
    (req, res) => {
      const memberId = req.params.id ?? "";
      const { name } = req.body as { name?: string };
      const sub = openSubAccount(memberId, name || "Untitled Sub-Account");
      const member = findMemberById(memberId);
      if (!member || !sub) {
        return res.status(404).render("error", {
          heading: "Member Not Found",
          message: `No member record exists for ID ${memberId}.`,
        });
      }
      res.render("subaccount-confirm", { member, subAccount: sub });
    }
  );

  app.get("/admin/faults", (_req, res) => {
    res.render("admin-faults", { modes: FAULT_MODES, current: getGlobalFault() });
  });

  app.post("/admin/faults", (req, res) => {
    const { mode } = req.body as { mode?: string };
    if (mode && (FAULT_MODES as string[]).includes(mode)) {
      setGlobalFault(mode as FaultMode);
    }
    res.redirect("/admin/faults");
  });

  return app;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  createApp().listen(port, () => {
    console.log(`Teller console mock app listening on http://localhost:${port}`);
  });
}
