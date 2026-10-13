import "dotenv/config";
import express from "express";
import dotenv from "dotenv";
dotenv.config();
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
// import { connectDB } from "./Db/index.js";
import morgan from "morgan";
import helmet from "helmet";
import bcrypt from "bcrypt";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ===== Security headers (SAFE CONFIG) =====
app.use(
  helmet({
    crossOriginResourcePolicy: false, // IMPORTANT for uploads & admin
  })
);
app.disable("x-powered-by");



if (process.env.NODE_ENV === "development") {
  const morgan = await import("morgan");
  app.use(morgan.default("dev"));
}

app.use("/public/image", express.static(path.join(__dirname, "public/images")));
app.use("/public", express.static(path.join(__dirname, "public")));

app.set("trust proxy", true);
app.use(express.json({ limit: "1000mb" }));
app.use(express.urlencoded({ limit: "1000mb", extended: true }));
app.use(cookieParser());

// Public Webhooks for Lead Sources (Website Forms, IndiaMart, JustDial, TradeIndia, Social)
import { receiveFormLead } from "./src/webhooks/forms-webhook.js";
import { receiveB2BLead } from "./src/webhooks/b2b-webhooks.js";

app.options("/api/v1/webhooks/forms/:key", cors());
app.post("/api/v1/webhooks/forms/:key", cors(), receiveFormLead);

// B2B Marketplaces Webhooks (IndiaMart, JustDial, TradeIndia, Social Media)
app.options("/api/v1/webhooks/:provider", cors());
app.post("/api/v1/webhooks/:provider", cors(), receiveB2BLead);
app.options("/api/v1/webhooks/:provider/:key", cors());
app.post("/api/v1/webhooks/:provider/:key", cors(), receiveB2BLead);

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3000/",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://192.168.166.80:3001",
  'https://api.nexflowcrm.com',
  'https://www.login.nexflowcrm.com',
  'https://login.nexflowcrm.com'
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));


// connectDB();

import adminRouter from "./src/admin/admin-routes.js";
import adminRoleRouter from "./src/system-settings/adminRole/adminRole-routes.js"
import companyRouter from "./src/system-settings/company/company-routes.js"
import leadsRouter from './src/leads/lead-routes.js';
import positionRouter from "./src/system-settings/position/position-routes.js"
import branchRoutes from "./src/system-settings/branchs/branch-routes.js";
import pipelineConfigRouter from './src/system-settings/pipelineConfig/pipeline-config-routes.js';
import industryTemplatesRouter from "./src/system-settings/industryTemplates/industry-templates-routes.js"
import quotationsRouter from "./src/quotations/quotations-routes.js";
import campaignsRouter from "./src/campaigns/campaigns-routes.js";
import projectsRouter from "./src/projects/projects-routes.js";
import callsRouter from "./src/calls/calls-routes.js";
import whatsappRouter from "./src/whatsapp/whatsapp-routes.js";
import leadCaptureRouter from "./src/lead-capture/lead-capture-routes.js";
import integrationsRouter from "./src/integrations/integrations-routes.js";
import workflowsRouter from "./src/workflows/workflows-routes.js";
import aiAgentRouter from "./src/ai-agent/ai-agent-routes.js";
import knowledgeBaseRouter from "./src/knowledge-base/knowledge-base-routes.js";
import reportsRouter from "./src/reports/reports-routes.js";
import activitiesRouter from "./src/activities/activities-routes.js";
import teamsRouter from "./src/system-settings/teams/teams-routes.js";
import notificationsRouter from "./src/notifications/notifications-routes.js";
import botRouter from "./src/bot/bot-routes.js";
import { initDb } from "./src/initDb.js";

// Initialize CRM DB Tables (UUID migration enabled)
initDb();

app.use("/api/v1/auth", adminRouter);
app.use("/api/v1/role", adminRoleRouter)
app.use("/api/v1/company", companyRouter);
app.use('/api/v1/leads', leadsRouter);
app.use("/api/v1/settings/positions", positionRouter)
app.use("/api/v1/branches", branchRoutes);
app.use('/api/v1/config', pipelineConfigRouter);
app.use("/api/v1/industry-templates", industryTemplatesRouter)
app.use("/api/v1/quotations", quotationsRouter);
app.use("/api/v1/campaigns", campaignsRouter);
app.use("/api/v1/projects", projectsRouter);
app.use("/api/v1/calls", callsRouter);
app.use("/api/v1/whatsapp", whatsappRouter);
app.use("/api/v1/lead-capture", leadCaptureRouter);
app.use("/api/v1/integrations", integrationsRouter);
app.use("/api/v1/workflows", workflowsRouter);
app.use("/api/v1/bot", botRouter);
app.use("/api/v1/ai-agent", aiAgentRouter);
app.use("/api/v1/kb", knowledgeBaseRouter);
app.use("/api/v1/knowledge-base", knowledgeBaseRouter);
app.use("/api/v1/reports", reportsRouter);
app.use("/api/v1/activities", activitiesRouter);
app.use("/api/v1/teams", teamsRouter);
app.use("/api/v1/notifications", notificationsRouter);

app.get("/", (req, res) => {
  res.send("Server is running");
});

// Workflows & Knowledge Base modules loaded
app.get("/developer", (req, res) => {
  res.send("AASIB KHAN CRM V2 - READY");
});

const port = process.env.PORT || 7000;
app.listen(port, "0.0.0.0", async () => {
  console.log({ message: `App is running on port ${port} (CRM Backend Ready - Lead Detail Fix V3)` });
  try {
    const { validateLlmEnv } = await import("./src/bot/llm/index.js");
    validateLlmEnv();
  } catch (e) {
    console.warn("[Bot] LLM env validation notice:", e.message);
  }
  try {
    const { startWorkflowScheduler } = await import("./src/workflows/workflow-scheduler.js");
    startWorkflowScheduler();
  } catch (e) {
    console.warn("[Workflows] Background scheduler notice:", e.message);
  }
});



