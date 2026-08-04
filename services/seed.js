const bcrypt = require("bcrypt");
const Client = require("../Models/Client");
const OpsUser = require("../Models/OpsUser");
const InventoryItem = require("../Models/InventoryItem");

const DEFAULT_KIT_ITEMS = [
  { sku: "EDTA-PURPLE", name: "EDTA Violet Tube", unit: "pcs", centralStock: 200, reorderThreshold: 30 },
  { sku: "SST-GOLD", name: "Serum Separator Tube", unit: "pcs", centralStock: 200, reorderThreshold: 30 },
  { sku: "FLUORIDE", name: "Fluoride Tube", unit: "pcs", centralStock: 100, reorderThreshold: 20 },
  { sku: "URINE-CUP", name: "Urine Container", unit: "pcs", centralStock: 100, reorderThreshold: 15 },
];

async function seedInventory() {
  for (const it of DEFAULT_KIT_ITEMS) {
    const exists = await InventoryItem.findOne({ sku: it.sku });
    if (!exists) {
      await InventoryItem.create(it);
      console.log(`[seed] Inventory item created: ${it.sku}`);
    }
  }
}

/**
 * Boot seed: Wello client + default ops admin (idempotent).
 * Env se API key / webhook fix kar sakte ho taaki Wello .env match kare.
 */
async function seedPlatform() {
  const slug = (process.env.WELLO_CLIENT_SLUG || "wello").toLowerCase();
  const name = process.env.WELLO_CLIENT_NAME || "Wello";
  const webhookUrl =
    process.env.WELLO_WEBHOOK_URL ||
    "http://localhost:3000/v1/api/phlebo/webhook";
  const fixedApiKey = process.env.WELLO_API_KEY || "";
  const fixedWebhookSecret = process.env.WELLO_WEBHOOK_SECRET || "";
  const catalogApiUrl =
    process.env.WELLO_CATALOG_API_BASE || "http://localhost:3000/v1/api";

  let client = await Client.findOne({ slug });
  if (!client) {
    client = await Client.create({
      name,
      slug,
      webhookUrl,
      catalogApiUrl,
      ...(fixedApiKey ? { apiKey: fixedApiKey } : {}),
      ...(fixedWebhookSecret ? { webhookSecret: fixedWebhookSecret } : {}),
      contactEmail: process.env.WELLO_CONTACT_EMAIL || "ops@wello.local",
      notes: "Default Wello website integration",
    });
    console.log(`[seed] Client created: ${client.slug}`);
  } else {
    let dirty = false;
    if (webhookUrl && client.webhookUrl !== webhookUrl) {
      client.webhookUrl = webhookUrl;
      dirty = true;
    }
    if (fixedApiKey && client.apiKey !== fixedApiKey) {
      client.apiKey = fixedApiKey;
      dirty = true;
    }
    if (fixedWebhookSecret && client.webhookSecret !== fixedWebhookSecret) {
      client.webhookSecret = fixedWebhookSecret;
      dirty = true;
    }
    if (!client.catalogApiUrl && catalogApiUrl) {
      client.catalogApiUrl = catalogApiUrl;
      dirty = true;
    } else if (catalogApiUrl && client.catalogApiUrl !== catalogApiUrl) {
      client.catalogApiUrl = catalogApiUrl;
      dirty = true;
    }
    if (dirty) {
      await client.save();
      console.log(`[seed] Client updated: ${client.slug}`);
    }
  }

  // Pehla superadmin env se AUTO create NAHI hota.
  // Sirf API: POST /v1/api/register-superadmin (header x-seed-key)
  // Uske baad superadmin khud city admins / labs banata hai.
  // Legacy: SEED_OPS_USER=true + OPS_EMAIL/OPS_PASSWORD se boot pe seed (optional).
  const seedOps = String(process.env.SEED_OPS_USER || "false").toLowerCase() === "true";
  if (seedOps) {
    const opsEmail = (process.env.OPS_EMAIL || "ops@phlebo.local").toLowerCase();
    const opsPassword = process.env.OPS_PASSWORD || "ops123456";
    let ops = await OpsUser.findOne({ email: opsEmail });
    if (!ops) {
      ops = await OpsUser.create({
        email: opsEmail,
        password: await bcrypt.hash(opsPassword, 10),
        name: "Phlebo Superadmin",
        role: "superadmin",
      });
      console.log(`[seed] Superadmin user: ${opsEmail} / ${opsPassword}`);
    } else if (ops.role === "admin" && !ops.city) {
      ops.role = "superadmin";
      await ops.save();
      console.log(`[seed] Upgraded existing ops user to superadmin: ${opsEmail}`);
    }
  } else {
    const hasSuper = await OpsUser.findOne({ role: "superadmin" }).select("_id");
    if (!hasSuper) {
      console.log(
        "[seed] No superadmin yet — create via POST /v1/api/register-superadmin (x-seed-key)"
      );
    }
  }

  await seedInventory();

  const superadmin = await OpsUser.findOne({ role: "superadmin" }).select("email");

  console.log("────────────────────────────────────────");
  console.log("Phlebo platform ready (own DB)");
  console.log(`  Client : ${client.name} (${client.slug})`);
  console.log(`  API key: ${client.apiKey}`);
  console.log(`  Webhook: ${client.webhookUrl}`);
  if (superadmin) {
    console.log(`  Ops    : ${superadmin.email}`);
  } else {
    console.log("  Ops    : (none) — POST /v1/api/register-superadmin");
  }
  console.log("  Put same API key in Wello .env → PHLEBO_API_KEY");
  console.log("────────────────────────────────────────");

  return { client, ops: superadmin || null };
}

module.exports = { seedPlatform };
