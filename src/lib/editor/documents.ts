import type { JSONContent } from '@tiptap/core';

const DB_NAME = 'safetyper-editor';
const DB_VERSION = 1;
const STORE = 'documents';

export interface StoredDocument {
  id: string;
  title: string;
  content: JSONContent;
  createdAt: number;
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open document storage.'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Document storage request failed.'));
  });
}

export async function listDocuments(): Promise<StoredDocument[]> {
  const db = await openDatabase();
  try {
    const documents = await requestToPromise(
      db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    );
    return (documents as StoredDocument[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function saveDocument(document: StoredDocument): Promise<void> {
  const db = await openDatabase();
  try {
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(document));
  } finally {
    db.close();
  }
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
}

export async function createDocument(input: {
  title: string;
  content: JSONContent;
}): Promise<StoredDocument> {
  const now = Date.now();
  const document: StoredDocument = {
    id: crypto.randomUUID(),
    title: input.title.trim() || 'Untitled',
    content: input.content,
    createdAt: now,
    updatedAt: now,
  };
  await saveDocument(document);
  return document;
}
