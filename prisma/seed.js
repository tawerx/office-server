import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const catalog = [
  { id: "chair", displayName: "Стул", iconKey: "chair", category: "furniture" },
  { id: "table", displayName: "Стол", iconKey: "table", category: "furniture" },
  {
    id: "computer",
    displayName: "Компьютер",
    iconKey: "computer",
    category: "device",
  },
  {
    id: "keyboard",
    displayName: "Клавиатура",
    iconKey: "keyboard",
    category: "device",
  },
  { id: "mouse", displayName: "Мышь", iconKey: "mouse", category: "device" },
  {
    id: "headphones",
    displayName: "Наушники",
    iconKey: "headphones",
    category: "device",
  },
  {
    id: "wifi",
    displayName: "Wi-Fi точка",
    iconKey: "wifi",
    category: "infra",
  },
  {
    id: "charging",
    displayName: "Зарядная станция",
    iconKey: "charging",
    category: "infra",
  },
  {
    id: "camera",
    displayName: "Камера",
    iconKey: "camera",
    category: "device",
  },
  {
    id: "printer",
    displayName: "Принтер",
    iconKey: "printer",
    category: "device",
  },
  {
    id: "printer_disabled",
    displayName: "Принтер (не работает)",
    iconKey: "printer_disabled",
    category: "device",
  },
  {
    id: "coffee",
    displayName: "Кофемашина",
    iconKey: "coffee",
    category: "kitchen",
  },
  {
    id: "fridge",
    displayName: "Холодильник",
    iconKey: "fridge",
    category: "kitchen",
  },
  {
    id: "microwave",
    displayName: "Микроволновка",
    iconKey: "microwave",
    category: "kitchen",
  },
  { id: "water", displayName: "Кулер", iconKey: "water", category: "kitchen" },
  { id: "docs", displayName: "Документы", iconKey: "docs", category: "infra" },
  {
    id: "wardrobe",
    displayName: "Гардероб",
    iconKey: "wardrobe",
    category: "room",
  },
  { id: "wash", displayName: "Мойка", iconKey: "wash", category: "room" },
  {
    id: "laundry",
    displayName: "Прачечная",
    iconKey: "laundry",
    category: "room",
  },
  {
    id: "bathroom",
    displayName: "Санузел",
    iconKey: "bathroom",
    category: "room",
  },
  {
    id: "speaker",
    displayName: "Колонка",
    iconKey: "speaker",
    category: "device",
  },
  { id: "mic", displayName: "Микрофон", iconKey: "mic", category: "device" },
  { id: "storage", displayName: "Склад", iconKey: "storage", category: "room" },
  {
    id: "fire",
    displayName: "Огнетушитель",
    iconKey: "fire",
    category: "safety",
  },
  { id: "hvac", displayName: "Вентиляция", iconKey: "hvac", category: "infra" },
  {
    id: "usb",
    displayName: "USB-устройство",
    iconKey: "usb",
    category: "device",
  },
  {
    id: "breakfast",
    displayName: "Буфет/кухня",
    iconKey: "breakfast",
    category: "kitchen",
  },
  { id: "fax", displayName: "Факс", iconKey: "fax", category: "device" },
  {
    id: "scanner",
    displayName: "Сканер",
    iconKey: "scanner",
    category: "device",
  },
  {
    id: "blender",
    displayName: "Блендер",
    iconKey: "blender",
    category: "kitchen",
  },
  { id: "iron", displayName: "Утюг", iconKey: "iron", category: "kitchen" },
  {
    id: "flash",
    displayName: "Освещение",
    iconKey: "flash",
    category: "infra",
  },
];

async function main() {
  for (const item of catalog) {
    await prisma.inventoryCatalog.upsert({
      where: { id: item.id },
      update: item,
      create: item,
    });
  }
  console.log("Catalog seeded");
}

main().finally(() => prisma.$disconnect());
