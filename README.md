# Phlebo Platform (standalone product)

Alag MongoDB + multi-website partner API. Wello sirf pehla client hai.

```
Wello / Clinic A / Lab B
        │  Bearer pk_live_…
        ▼
PhleboBackend :3010  →  MongoDB `phlebo`
        ▲
PhleboApp (field + Ops)
```

## Setup

```bash
cd D:\Wello\PhleboBackend
copy .env.example .env
npm install
npm run dev
```

Boot pe seed hota hai:
- Client `wello` + API key
- Ops user `ops@phlebo.local` / `ops123456`

## Partner API (dusri websites)

```http
POST /v1/api/partner/orders
Authorization: Bearer <apiKey>

{
  "externalOrderId": "64f…",
  "patientName": "Rahul",
  "mobileNumber": "98xxxxxxxx",
  "address": "…",
  "slotDate": "2026-07-20",
  "slotTime": "09:00-10:00",
  "tests / items": [],
  "totalAmount": 799
}

Legacy alias (same handler): POST /v1/api/partner/jobs
```

Naya client:

```http
POST /v1/api/partner/register-client
X-Seed-Key: phlebo-seed-dev

{ "name": "Clinic A", "slug": "clinic-a", "webhookUrl": "https://…" }
```

## CRM connect

Phlebo `.env` (alag CRM, Wello nahi):

```
CRM_CLIENT_SLUG=crm
CRM_CLIENT_NAME=Your CRM
CRM_API_KEY=pk_live_...
CRM_WEBHOOK_SECRET=whsec_...
CRM_WEBHOOK_URL=https://crm.example.com/webhooks/phlebo
PUBLIC_BASE_URL=https://your-phlebo-api
```

Restart backend → Admin → Clients se key copy. CRM team ko do:

- `docs/Phlebo_CRM_Partner_API_Integration.html`
- Base URL + API key + webhook secret

CRM: `POST /v1/api/partner/orders` (create), `GET …/orders/:externalOrderId` (status),
`PUT …/cancel`, `PUT …/reschedule`. Status webhook Phlebo → CRM.

Ya superadmin Admin → Clients se naya client bana sakta hai (env ke bina).

## Wello connect

Wello `.env`:
```
PHLEBO_API_BASE=http://localhost:3010/v1/api
PHLEBO_API_KEY=<same as WELLO_API_KEY in Phlebo .env>
PHLEBO_WEBHOOK_SECRET=<same as WELLO_WEBHOOK_SECRET>
```

`create-order` → auto Phlebo job. Status change → webhook → Wello order update.

## Multi-website phlebos

Phlebotomist pe `servesAllClients: true` (default) = saari websites.
Warna `clientIds: […]` se limit.
