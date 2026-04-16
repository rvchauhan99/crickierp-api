// import "dotenv/config";
// import mongoose from "mongoose";
// import { ExpenseTypeModel } from "../modules/masters/expense-type.model";
// import { UserModel } from "../modules/users/user.model";
// import { connectDb } from "../shared/db/connect";
// import { bootstrapData } from "../shared/db/bootstrap";
// import { logger } from "../shared/logger";

// async function main() {
//     if (process.env.NODE_ENV === "production") {
//         throw new Error("Database reset is refused when NODE_ENV=production");
//     }

//     await connectDb();
//     const db = mongoose.connection.db;
//     if (!db) {
//         throw new Error("Database connection has no db handle");
//     }

//     const preserve = new Set([
//         UserModel.collection.name,
//         ExpenseTypeModel.collection.name,
//     ]);

//     const dbName = db.databaseName;
//     const collections = await db.listCollections().toArray();
//     for (const { name } of collections) {
//         if (preserve.has(name)) continue;
//         await db.dropCollection(name);
//     }
//     logger.info({ dbName, preserved: [...preserve] }, "Dropped collections (users and expense types kept)");
//     await bootstrapData();
//     logger.info(
//         "Seeded permissions and superadmin — username: superadmin, password: SuperAdmin@123",
//     );
//     await mongoose.disconnect();
// }

// main().catch((error) => {
//     logger.error(error);
//     process.exit(1);
// });
