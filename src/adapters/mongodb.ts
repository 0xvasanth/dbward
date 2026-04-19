import { MongoClient, type Db, type Collection } from 'mongodb';
import type { ColumnInfo, DbAdapter, MongoQuery, QueryRequest, QueryResult } from './types.js';
import { sanitizeDriverError } from '../errors.js';

export class MongoAdapter implements DbAdapter {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
  ) {}

  async connect(): Promise<void> {
    this.client = new MongoClient(this.url, {
      serverSelectionTimeoutMS: this.timeoutMs,
    });
    await this.client.connect();
    this.db = this.client.db();
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.db = null;
  }

  async listTables(): Promise<string[]> {
    const db = this.require();
    const cols = await db.listCollections().toArray();
    return cols.map((c) => c.name).sort();
  }

  async describeTable(name: string): Promise<ColumnInfo[]> {
    const db = this.require();
    try {
      const docs = await db.collection(name).find({}).limit(20).toArray();
      const fields = new Map<string, Set<string>>();
      for (const doc of docs) {
        for (const [k, v] of Object.entries(doc)) {
          if (!fields.has(k)) fields.set(k, new Set());
          fields.get(k)!.add(typeofMongo(v));
        }
      }
      return [...fields.entries()].map(([fname, types]) => ({
        name: fname,
        type: [...types].join('|'),
        nullable: true,
      }));
    } catch (err) {
      throw sanitizeDriverError(err, `describeTable(${name})`);
    }
  }

  async execute(q: QueryRequest): Promise<QueryResult> {
    if (q.kind !== 'mongo') throw new Error('MongoAdapter only handles Mongo queries');
    const db = this.require();
    const col = db.collection(q.collection);
    try {
      return await dispatchMongo(col, q);
    } catch (err) {
      throw sanitizeDriverError(err, 'execute');
    }
  }

  private require(): Db {
    if (!this.db) throw new Error('MongoAdapter: not connected');
    return this.db;
  }
}

function typeofMongo(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date) return 'date';
  return typeof v;
}

async function dispatchMongo(col: Collection, q: MongoQuery): Promise<QueryResult> {
  switch (q.operation) {
    case 'find':
      return { rows: await col.find(q.filter ?? {}).toArray() };
    case 'aggregate':
      return { rows: await col.aggregate(q.pipeline ?? []).toArray() };
    case 'countDocuments':
      return { rows: [{ count: await col.countDocuments(q.filter ?? {}) }] };
    case 'insertOne': {
      if (!q.documents?.[0]) throw new Error('insertOne requires documents[0]');
      const r = await col.insertOne(q.documents[0]);
      return { rowsAffected: r.acknowledged ? 1 : 0 };
    }
    case 'insertMany': {
      if (!q.documents?.length) throw new Error('insertMany requires documents');
      const r = await col.insertMany(q.documents);
      return { rowsAffected: r.insertedCount };
    }
    case 'updateOne': {
      const r = await col.updateOne(q.filter ?? {}, q.update ?? {});
      return { rowsAffected: r.modifiedCount };
    }
    case 'updateMany': {
      const r = await col.updateMany(q.filter ?? {}, q.update ?? {});
      return { rowsAffected: r.modifiedCount };
    }
    case 'deleteOne': {
      const r = await col.deleteOne(q.filter ?? {});
      return { rowsAffected: r.deletedCount };
    }
    case 'deleteMany': {
      const r = await col.deleteMany(q.filter ?? {});
      return { rowsAffected: r.deletedCount };
    }
  }
}
