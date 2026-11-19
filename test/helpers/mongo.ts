import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { bootstrapDatabase } from "../../src/db/bootstrap.js";

export interface TestMongo {
  server: MongoMemoryServer;
  client: MongoClient;
  db: Db;
  stop: () => Promise<void>;
}

export async function startTestMongo(): Promise<TestMongo> {
  const server = await MongoMemoryServer.create();
  const client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db("marchex_test");
  await bootstrapDatabase(db);

  return {
    server,
    client,
    db,
    stop: async () => {
      await client.close();
      await server.stop();
    },
  };
}
