import { PrismaClient } from "@prisma/client";

// Singleton — one PrismaClient instance for the lifetime of the process
const prisma = new PrismaClient();

export default prisma;
