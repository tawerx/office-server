import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const JWT_EXPIRES_IN = "1d"; // срок жизни access-токена

/**
 * Новый формат токена под фронт:
 * {
 *   sub: string,               // username (берём email как username)
 *   role: 'USER' | 'WORKSPACE_ADMIN' | 'PROJECT_ADMIN',
 *   perms?: string[],
 *   type?: 'ACCESS',
 *   iat?: number,
 *   exp?: number
 * }
 */
function signAccessToken(email, role, perms = []) {
  const payload = {
    sub: email,
    role,
    perms,
    type: "ACCESS",
  };
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: "HS256",
  });
}

function authOptional(req, _res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return next();
  try {
    req.user = jwt.verify(m[1], JWT_SECRET);
  } catch {
    // игнорируем — как неавторизован
  }
  next();
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Missing Bearer token" });
  try {
    req.user = jwt.verify(m[1], JWT_SECRET);
    next();
  } catch (_e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use(authOptional);

// ======= статика для файлов =======
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.join(__dirname, ".", "uploads");
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
app.use("/uploads", express.static(UPLOAD_ROOT));

// ======= Multer storage (uploads/floors/{floorId}/.) =======
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const floorId = String(req.params.floorId || "common");
    const dir = path.join(UPLOAD_ROOT, "floors", floorId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.mimetype))
      return cb(new Error("Unsupported file type"));
    cb(null, true);
  },
});
function toPublicUrl(absFilePath) {
  const rel = path.relative(UPLOAD_ROOT, absFilePath).replace(/\\/g, "/");
  return `/uploads/${rel}`;
}

// ===================== HEALTH =====================
app.get("/health", (_req, res) => res.json({ ok: true }));

// ===================== FLOORS =====================
// GET /offices/:officeId/floors  -> { floors:[{id, number}] }
app.get("/offices/:officeId/floors", authRequired, async (req, res, next) => {
  try {
    const officeId = Number(req.params.officeId);
    const floors = await prisma.floor.findMany({
      where: { officeId },
      select: { id: true, number: true },
      orderBy: { number: "asc" },
    });
    res.json({ floors });
  } catch (e) {
    next(e);
  }
});

// DELETE /offices/:officeId/floors/:floorId  -> 204
app.delete(
  "/offices/:officeId/floors/:floorId",
  authRequired,
  requireRole("WORKSPACE_ADMIN", "PROJECT_ADMIN"),
  async (req, res, next) => {
    try {
      const officeId = Number(req.params.officeId);
      const floorId = Number(req.params.floorId);
      if (!Number.isInteger(officeId) || !Number.isInteger(floorId)) {
        return res.status(400).json({ error: "Invalid officeId or floorId" });
      }

      const floor = await prisma.floor.findFirst({
        where: { id: floorId, officeId },
        select: { id: true },
      });
      if (!floor) return res.status(404).json({ error: "Floor not found" });

      try {
        await prisma.floor.delete({ where: { id: floorId } });
      } catch (_e) {
        await prisma.$transaction(async (tx) => {
          const zones = await tx.zone.findMany({
            where: { floorId },
            select: { id: true },
          });
          const zoneIds = zones.map((z) => z.id);

          if (zoneIds.length) {
            await tx.zoneObject.deleteMany({
              where: { zoneId: { in: zoneIds } },
            });
            await tx.zoneInventory.deleteMany({
              where: { zoneId: { in: zoneIds } },
            });
          }

          await tx.zone.deleteMany({ where: { floorId } });
          await tx.floorInventory.deleteMany({ where: { floorId } });
          await tx.layer.deleteMany({ where: { floorId } });

          await tx.floor.delete({ where: { id: floorId } });
        });
      }

      try {
        const dir = path.join(UPLOAD_ROOT, "floors", String(floorId));
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}

      return res.status(204).end();
    } catch (err) {
      if (err?.code === "P2025")
        return res.status(404).json({ error: "Floor not found" });
      next(err);
    }
  }
);

// POST /offices/:officeId/floors  { floorNumber } -> { floorId }
// + автоматически создаём слой type='firesafe'
app.post("/offices/:officeId/floors", authRequired, async (req, res, next) => {
  try {
    const officeId = Number(req.params.officeId);
    const { floorNumber } = req.body;
    if (!Number.isFinite(officeId) || !Number.isFinite(floorNumber))
      return res.status(400).json({ error: "Invalid officeId or floorNumber" });

    const result = await prisma
      .$transaction(async (tx) => {
        const floor = await tx.floor.create({
          data: { officeId, number: floorNumber },
          select: { id: true },
        });
        await tx.layer.create({
          data: { floorId: floor.id, name: "Пожарный план", type: "firesafe" },
        });
        return floor;
      })
      .catch((e) => {
        if (e.code === "P2002") return { conflict: true };
        throw e;
      });

    if (result?.conflict)
      return res.status(409).json({ error: "Floor number already exists" });

    res.status(201).json({ floorId: result.id });
  } catch (e) {
    next(e);
  }
});

// GET /offices/:officeId/floors/:floorId -> { id, number, imageUrl }
app.get(
  "/offices/:officeId/floors/:floorId",
  authRequired,
  async (req, res, next) => {
    try {
      const officeId = Number(req.params.officeId);
      const floorId = Number(req.params.floorId);
      const floor = await prisma.floor.findFirst({
        where: { id: floorId, officeId },
        select: { id: true, number: true, planImageUrl: true },
      });
      if (!floor) return res.status(404).json({ error: "Floor not found" });
      res.json({
        id: floor.id,
        number: floor.number,
        imageUrl: floor.planImageUrl,
      });
    } catch (e) {
      next(e);
    }
  }
);

// ========== PLAN IMAGE ==========
app.post(
  "/offices/:officeId/floors/:floorId/plan-image",
  authRequired,
  upload.single("image"),
  async (req, res, next) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "image is required" });
      const floorId = Number(req.params.floorId);
      const imageUrl = toPublicUrl(req.file.path);
      await prisma.floor.update({
        where: { id: floorId },
        data: { planImageUrl: imageUrl },
      });
      res.json({ imageUrl, updatedAt: new Date().toISOString() });
    } catch (e) {
      next(e);
    }
  }
);
app.get(
  "/offices/:officeId/floors/:floorId/plan-image",
  authRequired,
  async (req, res, next) => {
    try {
      const floorId = Number(req.params.floorId);
      const f = await prisma.floor.findUnique({
        where: { id: floorId },
        select: { planImageUrl: true },
      });
      if (!f) return res.status(404).json({ error: "Floor not found" });
      if (!f.planImageUrl)
        return res.status(404).json({ error: "Plan image not set" });
      res.json({ imageUrl: f.planImageUrl, updatedAt: null });
    } catch (e) {
      next(e);
    }
  }
);

// ========== FIRESAFE IMAGE ==========
app.post(
  "/offices/:officeId/floors/:floorId/firesafe-image",
  authRequired,
  upload.single("image"),
  async (req, res, next) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "image is required" });
      const floorId = Number(req.params.floorId);
      const imageUrl = toPublicUrl(req.file.path);
      await prisma.floor.update({
        where: { id: floorId },
        data: { firesafeImageUrl: imageUrl },
      });
      res.json({ imageUrl, updatedAt: new Date().toISOString() });
    } catch (e) {
      next(e);
    }
  }
);
app.get(
  "/offices/:officeId/floors/:floorId/firesafe-image",
  authRequired,
  async (req, res, next) => {
    try {
      const floorId = Number(req.params.floorId);
      const f = await prisma.floor.findUnique({
        where: { id: floorId },
        select: { firesafeImageUrl: true },
      });
      if (!f) return res.status(404).json({ error: "Floor not found" });
      if (!f.firesafeImageUrl)
        return res.status(404).json({ error: "FireSafe image not set" });
      res.json({ imageUrl: f.firesafeImageUrl, updatedAt: null });
    } catch (e) {
      next(e);
    }
  }
);

// ===================== LAYERS =====================
app.get(
  "/offices/:officeId/floors/:floorId/layers",
  authRequired,
  async (req, res, next) => {
    try {
      const floorId = Number(req.params.floorId);
      const floor = await prisma.floor.findUnique({
        where: { id: floorId },
        select: { firesafeImageUrl: true },
      });
      const layers = await prisma.layer.findMany({
        where: { floorId },
        select: { id: true, name: true, type: true },
        orderBy: [{ type: "asc" }, { id: "asc" }],
      });
      const result = layers.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        hasImage: l.type === "firesafe" ? !!floor?.firesafeImageUrl : undefined,
      }));
      res.json({ layers: result });
    } catch (e) {
      next(e);
    }
  }
);

app.post(
  "/offices/:officeId/floors/:floorId/layers",
  authRequired,
  async (req, res, next) => {
    try {
      const floorId = Number(req.params.floorId);
      const { name } = req.body;
      if (!name?.trim())
        return res.status(400).json({ error: "name required" });
      const layer = await prisma.layer.create({
        data: { floorId, name: name.trim(), type: "custom" },
        select: { id: true, name: true },
      });
      res.status(201).json({ layerId: layer.id, name: layer.name });
    } catch (e) {
      next(e);
    }
  }
);

app.get(
  "/offices/:officeId/floors/:floorId/layers/:layerId",
  authRequired,
  async (req, res, next) => {
    try {
      const floorId = Number(req.params.floorId);
      const layerId = Number(req.params.layerId);

      const layer = await prisma.layer.findFirst({
        where: { id: layerId, floorId },
        select: {
          id: true,
          name: true,
          type: true,
          floor: { select: { firesafeImageUrl: true } },
        },
      });
      if (!layer) return res.status(404).json({ error: "Layer not found" });

      if (layer.type === "firesafe") {
        return res.json({
          id: layer.id,
          name: layer.name,
          type: layer.type,
          imageUrl: layer.floor.firesafeImageUrl ?? null,
        });
      }

      const zones = await prisma.zone.findMany({
        where: { layerId },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          coordinates: true,
        },
        orderBy: { id: "asc" },
      });
      res.json({ id: layer.id, name: layer.name, type: layer.type, zones });
    } catch (e) {
      next(e);
    }
  }
);

app.delete(
  "/offices/:officeId/floors/:floorId/layers/:layerId",
  authRequired,
  async (req, res, next) => {
    try {
      const floorId = Number(req.params.floorId);
      const layerId = Number(req.params.layerId);
      const layer = await prisma.layer.findFirst({
        where: { id: layerId, floorId },
        select: { type: true },
      });
      if (!layer) return res.status(404).json({ error: "Layer not found" });
      if (layer.type === "firesafe")
        return res.status(400).json({ error: "Cannot delete firesafe layer" });
      await prisma.layer.delete({ where: { id: layerId } });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  }
);

// ===================== ZONES (custom layers) =====================
app.post(
  "/offices/:officeId/floors/:floorId/layers/:layerId/zones",
  authRequired,
  async (req, res, next) => {
    try {
      const layerId = Number(req.params.layerId);
      const {
        name = "",
        description = "",
        status = "free",
        coordinates,
      } = req.body;

      if (!Array.isArray(coordinates) || coordinates.length < 6)
        return res
          .status(400)
          .json({ error: "coordinates must be [x1,y1,] with >= 3 points" });
      if (!["free", "occupied"].includes(status))
        return res
          .status(400)
          .json({ error: "status must be 'free' or 'occupied'" });

      const layer = await prisma.layer.findUnique({
        where: { id: layerId },
        select: { type: true, floorId: true },
      });
      if (!layer) return res.status(404).json({ error: "Layer not found" });
      if (layer.type !== "custom")
        return res
          .status(400)
          .json({ error: "Zones allowed only for custom layers" });

      const z = await prisma.zone.create({
        data: {
          layerId,
          floorId: layer.floorId,
          name,
          description,
          status,
          coordinates,
        },
        select: { id: true },
      });
      res.status(201).json({ zoneId: z.id, coordinates });
    } catch (e) {
      next(e);
    }
  }
);

app.patch(
  "/offices/:officeId/floors/:floorId/layers/:layerId/zones/:zoneId",
  authRequired,
  async (req, res, next) => {
    try {
      const layerId = Number(req.params.layerId);
      const zoneId = Number(req.params.zoneId);
      const { name, description, status, coordinates } = req.body;

      const zone = await prisma.zone.findFirst({
        where: { id: zoneId, layerId },
        select: { id: true },
      });
      if (!zone) return res.status(404).json({ error: "Zone not found" });

      const data = {};
      if (typeof name === "string") data.name = name;
      if (typeof description === "string") data.description = description;
      if (typeof status === "string") {
        if (!["free", "occupied"].includes(status))
          return res
            .status(400)
            .json({ error: "status must be 'free' or 'occupied'" });
        data.status = status;
      }
      if (Array.isArray(coordinates)) {
        if (coordinates.length < 6)
          return res
            .status(400)
            .json({ error: "coordinates must have >= 3 points" });
        data.coordinates = coordinates;
      }
      if (Object.keys(data).length === 0)
        return res.status(400).json({ error: "No fields to update" });

      await prisma.zone.update({ where: { id: zoneId }, data });
      res.json({ id: zoneId, updated: true });
    } catch (e) {
      next(e);
    }
  }
);

app.delete(
  "/offices/:officeId/floors/:floorId/layers/:layerId/zones/:zoneId",
  authRequired,
  async (req, res, next) => {
    try {
      const layerId = Number(req.params.layerId);
      const zoneId = Number(req.params.zoneId);
      const del = await prisma.zone.deleteMany({
        where: { id: zoneId, layerId },
      });
      if (del.count === 0)
        return res.status(404).json({ error: "Zone not found" });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  }
);

// ===================== INVENTORY CATALOG =====================
app.get("/inventory/catalog", authRequired, async (_req, res, next) => {
  try {
    const items = await prisma.inventoryCatalog.findMany({
      orderBy: [{ category: "asc" }, { displayName: "asc" }],
    });
    res.json(items);
  } catch (e) {
    next(e);
  }
});

// ===================== FLOOR INVENTORY =====================
app.get(
  "/offices/:officeId/floors/:floorId/inventory",
  authRequired,
  async (req, res, next) => {
    try {
      const floorId = Number(req.params.floorId);
      if (!Number.isFinite(floorId))
        return res.status(400).json({ error: "Invalid floorId" });

      const items = await prisma.floorInventory.findMany({
        where: { floorId },
        include: { catalog: true },
        orderBy: [{ catalog: { displayName: "asc" } }],
      });
      res.json(items);
    } catch (e) {
      next(e);
    }
  }
);

app.get(
  "/offices/:officeId/floors/:floorId/inventory/with-usage",
  authRequired,
  async (req, res, next) => {
    try {
      const floorId = Number(req.params.floorId);
      if (!Number.isFinite(floorId))
        return res.status(400).json({ error: "Invalid floorId" });

      const items = await prisma.floorInventory.findMany({
        where: { floorId },
        include: { catalog: true, zoneItems: true },
        orderBy: [{ catalog: { displayName: "asc" } }],
      });

      const result = await Promise.all(
        items.map(async (it) => {
          const agg = await prisma.zoneInventory.aggregate({
            where: { floorInventoryId: it.id },
            _sum: { quantity: true },
          });
          const used = agg._sum.quantity ?? 0;
          return {
            id: it.id,
            floorId: it.floorId,
            catalogId: it.catalogId,
            count: it.count,
            used,
            available: Math.max(it.count - used, 0),
            catalog: it.catalog,
          };
        })
      );

      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

app.post(
  "/offices/:officeId/floors/:floorId/inventory",
  authRequired,
  async (req, res, next) => {
    try {
      const floorId = Number(req.params.floorId);
      const { catalogId, count } = req.body || {};
      if (!Number.isFinite(floorId))
        return res.status(400).json({ error: "Invalid floorId" });
      if (typeof catalogId !== "string" || !catalogId.trim())
        return res.status(400).json({ error: "catalogId required" });
      if (!Number.isInteger(count) || count < 0)
        return res.status(400).json({ error: "count must be integer >= 0" });

      const exists = await prisma.inventoryCatalog.findUnique({
        where: { id: catalogId },
      });
      if (!exists) return res.status(400).json({ error: "Unknown catalogId" });

      try {
        const created = await prisma.floorInventory.create({
          data: { floorId, catalogId, count },
          include: { catalog: true },
        });
        return res.status(201).json(created);
      } catch (e) {
        if (e.code === "P2002")
          return res
            .status(409)
            .json({ error: "Item already exists for this floor" });
        throw e;
      }
    } catch (e) {
      next(e);
    }
  }
);

app.patch(
  "/offices/:officeId/floors/:floorId/inventory/:id",
  authRequired,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const { count } = req.body || {};
      if (!Number.isInteger(id))
        return res.status(400).json({ error: "Invalid id" });
      if (count != null && (!Number.isInteger(count) || count < 0))
        return res.status(400).json({ error: "count must be integer >= 0" });

      const updated = await prisma.floorInventory.update({
        where: { id },
        data: { ...(count != null ? { count } : {}) },
        include: { catalog: true },
      });
      res.json(updated);
    } catch (e) {
      if (e.code === "P2025")
        return res.status(404).json({ error: "Inventory item not found" });
      next(e);
    }
  }
);

app.delete(
  "/offices/:officeId/floors/:floorId/inventory/:id",
  authRequired,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id))
        return res.status(400).json({ error: "Invalid id" });
      await prisma.zoneInventory.deleteMany({
        where: { floorInventoryId: id },
      });
      await prisma.floorInventory.delete({ where: { id } });
      res.status(204).end();
    } catch (e) {
      if (e.code === "P2025")
        return res.status(404).json({ error: "Inventory item not found" });
      next(e);
    }
  }
);

// ===================== ZONE INVENTORY =====================
app.get(
  "/offices/:officeId/floors/:floorId/zones/:zoneId/inventory",
  authRequired,
  async (req, res, next) => {
    try {
      const zoneId = Number(req.params.zoneId);
      if (!Number.isFinite(zoneId))
        return res.status(400).json({ error: "Invalid zoneId" });

      const rows = await prisma.zoneInventory.findMany({
        where: { zoneId },
        include: { floorInventory: { include: { catalog: true } } },
        orderBy: { id: "asc" },
      });
      res.json(rows);
    } catch (e) {
      next(e);
    }
  }
);

app.post(
  "/offices/:officeId/floors/:floorId/zones/:zoneId/inventory",
  authRequired,
  async (req, res, next) => {
    try {
      const zoneId = Number(req.params.zoneId);
      const { floorInventoryId, quantity } = req.body || {};
      if (!Number.isInteger(zoneId))
        return res.status(400).json({ error: "Invalid zoneId" });
      if (!Number.isInteger(floorInventoryId))
        return res
          .status(400)
          .json({ error: "floorInventoryId required (int)" });
      if (!Number.isInteger(quantity) || quantity < 0)
        return res.status(400).json({ error: "quantity must be int >= 0" });

      const created = await prisma.$transaction(async (tx) => {
        const fi = await tx.floorInventory.findUnique({
          where: { id: floorInventoryId },
          include: { catalog: true },
        });
        if (!fi)
          throw Object.assign(new Error("Inventory item not found"), {
            status: 404,
          });

        const agg = await tx.zoneInventory.aggregate({
          where: { floorInventoryId },
          _sum: { quantity: true },
        });
        const used = agg._sum.quantity ?? 0;
        const available = fi.count - used;
        if (quantity > available) {
          const err = new Error(`Not enough available. left=${available}`);
          err.status = 409;
          throw err;
        }

        const exists = await tx.zoneInventory
          .findUnique({
            where: { zoneId_floorInventoryId: { zoneId, floorInventoryId } },
          })
          .catch(() => null);
        if (exists) {
          const err = new Error("Already attached, use PATCH");
          err.status = 409;
          throw err;
        }

        return tx.zoneInventory.create({
          data: { zoneId, floorInventoryId, quantity },
        });
      });

      res.status(201).json(created);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      if (e.code === "P2002")
        return res
          .status(409)
          .json({ error: "Duplicate (zoneId,floorInventoryId)" });
      next(e);
    }
  }
);

app.patch(
  "/offices/:officeId/floors/:floorId/zones/:zoneId/inventory/:id",
  authRequired,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const { quantity } = req.body || {};
      if (!Number.isInteger(id))
        return res.status(400).json({ error: "Invalid id" });
      if (!Number.isInteger(quantity) || quantity < 0)
        return res.status(400).json({ error: "quantity must be int >= 0" });

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.zoneInventory.findUnique({
          where: { id },
          include: { floorInventory: true },
        });
        if (!row) throw Object.assign(new Error("Not found"), { status: 404 });

        const agg = await tx.zoneInventory.aggregate({
          where: { floorInventoryId: row.floorInventoryId, NOT: { id } },
          _sum: { quantity: true },
        });
        const usedOthers = agg._sum.quantity ?? 0;
        const availableForThis = row.floorInventory.count - usedOthers;
        if (quantity > availableForThis) {
          const err = new Error(
            `Not enough available. left=${availableForThis}`
          );
          err.status = 409;
          throw err;
        }

        return tx.zoneInventory.update({ where: { id }, data: { quantity } });
      });

      res.json(updated);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  }
);

app.delete(
  "/offices/:officeId/floors/:floorId/zones/:zoneId/inventory/:id",
  authRequired,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id))
        return res.status(400).json({ error: "Invalid id" });
      await prisma.zoneInventory.delete({ where: { id } });
      res.status(204).end();
    } catch (e) {
      if (e.code === "P2025")
        return res.status(404).json({ error: "Not found" });
      next(e);
    }
  }
);

// ===================== ZONE OBJECTS =====================
app.get(
  "/offices/:officeId/floors/:floorId/zones/:zoneId/objects",
  authRequired,
  async (req, res, next) => {
    try {
      const zoneId = Number(req.params.zoneId);
      if (!Number.isFinite(zoneId))
        return res.status(400).json({ error: "Invalid zoneId" });

      const list = await prisma.zoneObject.findMany({
        where: { zoneId },
        orderBy: { id: "asc" },
        include: {
          zoneInventory: {
            include: { floorInventory: { include: { catalog: true } } },
          },
        },
      });

      const result = list.map((o) => ({
        id: o.id,
        zoneId: o.zoneId,
        zoneInventoryId: o.zoneInventoryId,
        x: o.x,
        y: o.y,
        rotation: o.rotation,
        catalog: {
          id: o.zoneInventory.floorInventory.catalog.id,
          displayName: o.zoneInventory.floorInventory.catalog.displayName,
          iconKey: o.zoneInventory.floorInventory.catalog.iconKey,
          category: o.zoneInventory.floorInventory.catalog.category || null,
        },
      }));

      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

app.post(
  "/offices/:officeId/floors/:floorId/zones/:zoneId/objects",
  authRequired,
  async (req, res, next) => {
    try {
      const zoneId = Number(req.params.zoneId);
      const { zoneInventoryId, x, y, rotation } = req.body || {};
      if (!Number.isFinite(zoneId))
        return res.status(400).json({ error: "Invalid zoneId" });
      if (!Number.isInteger(zoneInventoryId))
        return res
          .status(400)
          .json({ error: "zoneInventoryId required (int)" });
      if (typeof x !== "number" || typeof y !== "number")
        return res.status(400).json({ error: "x and y must be numbers" });

      const created = await prisma.$transaction(async (tx) => {
        const zi = await tx.zoneInventory.findUnique({
          where: { id: zoneInventoryId },
          select: { id: true, zoneId: true },
        });
        if (!zi)
          throw Object.assign(new Error("Zone inventory not found"), {
            status: 404,
          });
        if (zi.zoneId !== zoneId) {
          const err = new Error("zoneInventoryId does not belong to this zone");
          err.status = 400;
          throw err;
        }

        await tx.zoneInventory.update({
          where: { id: zoneInventoryId },
          data: { quantity: { increment: 1 } },
        });

        const obj = await tx.zoneObject.create({
          data: {
            zoneId,
            zoneInventoryId,
            x,
            y,
            rotation: typeof rotation === "number" ? rotation : 0,
          },
        });

        return obj;
      });

      res.status(201).json(created);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  }
);

app.patch(
  "/offices/:officeId/floors/:floorId/zones/:zoneId/objects/:id",
  authRequired,
  async (req, res, next) => {
    try {
      const zoneId = Number(req.params.zoneId);
      const id = Number(req.params.id);
      if (!Number.isFinite(zoneId) || !Number.isFinite(id))
        return res.status(400).json({ error: "Invalid ids" });

      const { x, y, rotation } = req.body || {};
      const data = {};
      if (x != null) {
        if (typeof x !== "number")
          return res.status(400).json({ error: "x must be number" });
        data.x = x;
      }
      if (y != null) {
        if (typeof y !== "number")
          return res.status(400).json({ error: "y must be number" });
        data.y = y;
      }
      if (rotation != null) {
        if (typeof rotation !== "number")
          return res.status(400).json({ error: "rotation must be number" });
        data.rotation = rotation;
      }
      if (Object.keys(data).length === 0)
        return res.status(400).json({ error: "No fields to update" });

      const obj = await prisma.zoneObject.findUnique({
        where: { id },
        select: { zoneId: true },
      });
      if (!obj) return res.status(404).json({ error: "Object not found" });
      if (obj.zoneId !== zoneId)
        return res
          .status(400)
          .json({ error: "Object does not belong to this zone" });

      const updated = await prisma.zoneObject.update({ where: { id }, data });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  }
);

app.delete(
  "/offices/:officeId/floors/:floorId/zones/:zoneId/objects/:id",
  authRequired,
  async (req, res, next) => {
    try {
      const zoneId = Number(req.params.zoneId);
      const id = Number(req.params.id);
      if (!Number.isFinite(zoneId) || !Number.isFinite(id))
        return res.status(400).json({ error: "Invalid ids" });

      await prisma.$transaction(async (tx) => {
        const obj = await tx.zoneObject.findUnique({
          where: { id },
          select: { zoneId: true, zoneInventoryId: true },
        });
        if (!obj)
          throw Object.assign(new Error("Object not found"), { status: 404 });
        if (obj.zoneId !== zoneId) {
          const err = new Error("Object does not belong to this zone");
          err.status = 400;
          throw err;
        }

        await tx.zoneObject.delete({ where: { id } });

        await tx.zoneInventory
          .update({
            where: { id: obj.zoneInventoryId },
            data: { quantity: { decrement: 1 } },
          })
          .catch(async (e) => {
            const zi = await tx.zoneInventory.findUnique({
              where: { id: obj.zoneInventoryId },
              select: { quantity: true },
            });
            if (zi && zi.quantity > 0) throw e;
          });
      });

      res.status(204).end();
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      if (e.code === "P2025")
        return res.status(404).json({ error: "Object not found" });
      next(e);
    }
  }
);

// ============ AUTH (переписано под новый токен) ============
app.get(
  "/auth/users",
  authRequired,
  requireRole("WORKSPACE_ADMIN", "PROJECT_ADMIN"),
  async (req, res, next) => {
    try {
      const { q, limit = "50", offset = "0" } = req.query;

      const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const skip = Math.max(parseInt(offset, 10) || 0, 0);

      const where = q
        ? {
            email: {
              contains: String(q),
              mode: "insensitive",
            },
          }
        : undefined;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: { id: true, email: true, role: true },
          orderBy: { id: "desc" }, // стабильный порядок без предположений о createdAt
          skip,
          take,
        }),
        prisma.user.count({ where }),
      ]);

      res.json({
        users,
      });
    } catch (e) {
      next(e);
    }
  }
);

app.post("/auth/register", async (req, res, next) => {
  try {
    const { email, password, role } = req.body || {};
    if (typeof email !== "string" || !email.includes("@"))
      return res.status(400).json({ error: "valid email required" });
    if (typeof password !== "string" || password.length < 6)
      return res.status(400).json({ error: "password must be >= 6 chars" });

    const usersCount = await prisma.user.count();
    // Первый зарегистрированный юзер — даём PROJECT_ADMIN (или USER, если хочешь строже)
    const allowed = ["USER", "WORKSPACE_ADMIN", "PROJECT_ADMIN"];
    const finalRole =
      usersCount === 0
        ? "PROJECT_ADMIN"
        : allowed.includes(role)
        ? role
        : "USER";

    const hash = await bcrypt.hash(password, 10);
    const created = await prisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        passwordHash: hash,
        role: finalRole,
      },
      select: { email: true, role: true },
    });

    const accessToken = signAccessToken(created.email, created.role, []);
    // Возвращаем только токен (без user-объекта)
    res.status(201).json({ accessToken });
  } catch (e) {
    if (e.code === "P2002")
      return res.status(409).json({ error: "email is taken" });
    next(e);
  }
});

app.post("/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: "email & password required" });

    const user = await prisma.user.findUnique({
      where: { email: String(email).toLowerCase() },
    });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const accessToken = signAccessToken(user.email, user.role, []);
    // Только токен, как требует фронт
    res.json({ accessToken });
  } catch (e) {
    next(e);
  }
});

app.get("/me", authRequired, (req, res) => {
  // отдаём то, что внутри токена (payload)
  res.json({ user: req.user });
});

app.post("/auth/logout", authRequired, async (_req, res) => {
  // Без refresh/tokenVersion отозвать access невозможно — клиент сам забывает токен
  res.json({ message: "Logged out" });
});

// ============ OFFICES CRUD ============
app.get("/offices", authRequired, async (_req, res, next) => {
  try {
    const offices = await prisma.office.findMany({
      orderBy: [{ country: "asc" }, { city: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        country: true,
      },
    });
    res.json(offices);
  } catch (e) {
    next(e);
  }
});

app.post(
  "/offices",
  authRequired,
  requireRole("WORKSPACE_ADMIN", "PROJECT_ADMIN"),
  async (req, res, next) => {
    try {
      const { name, address, city, country } = req.body || {};
      if (
        ![name, address, city, country].every(
          (v) => typeof v === "string" && v.trim()
        )
      )
        return res
          .status(400)
          .json({ error: "name,address,city,country are required" });

      const created = await prisma.office.create({
        data: {
          name: name.trim(),
          address: address.trim(),
          city: city.trim(),
          country: country.trim(),
        },
        select: { id: true },
      });
      res.status(201).json({ id: created.id });
    } catch (e) {
      next(e);
    }
  }
);

app.put(
  "/offices/:id",
  authRequired,
  requireRole("WORKSPACE_ADMIN", "PROJECT_ADMIN"),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id))
        return res.status(400).json({ error: "Invalid id" });

      const data = {};
      const { name, address, city, country } = req.body || {};
      if (typeof name === "string") data.name = name.trim();
      if (typeof address === "string") data.address = address.trim();
      if (typeof city === "string") data.city = city.trim();
      if (typeof country === "string") data.country = country.trim();
      if (Object.keys(data).length === 0)
        return res.status(400).json({ error: "No fields to update" });

      await prisma.office.update({ where: { id }, data });
      res.json({ updated: true });
    } catch (e) {
      if (e.code === "P2025")
        return res.status(404).json({ error: "Office not found" });
      next(e);
    }
  }
);

app.delete(
  "/offices/:id",
  authRequired,
  requireRole("WORKSPACE_ADMIN", "PROJECT_ADMIN"),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id))
        return res.status(400).json({ error: "Invalid id" });

      const floorsCount = await prisma.floor.count({ where: { officeId: id } });
      if (floorsCount > 0)
        return res
          .status(409)
          .json({ error: "Office has floors, delete them first" });

      await prisma.office.delete({ where: { id } });
      res.status(204).end();
    } catch (e) {
      if (e.code === "P2025")
        return res.status(404).json({ error: "Office not found" });
      next(e);
    }
  }
);

// ===================== START =====================
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`API running http://localhost:${PORT}`));
