export interface Document {
  id: string;
  title: string;
  markdown: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  lastEditedBy: string;
}

export interface CreateDocumentInput {
  title: string;
  markdown?: string;
}

export interface UpdateDocumentInput {
  title?: string;
  markdown?: string;
}

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8787';
const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';

function getEmail(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('user_email');
    }
  } catch {}
  return null;
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  const email = getEmail();
  if (email) headers['X-User-Email'] = email;

  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

export const documentsService = {
  async list(): Promise<Document[]> {
    const data = await apiFetch('/api/documents');
    return data.documents || [];
  },

  async get(id: string): Promise<Document> {
    const data = await apiFetch(`/api/documents/${id}`);
    return data.document;
  },

  async create(input: CreateDocumentInput): Promise<Document> {
    const data = await apiFetch('/api/documents', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return data.document;
  },

  async update(id: string, input: UpdateDocumentInput): Promise<Document> {
    const data = await apiFetch(`/api/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return data.document;
  },

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/documents/${id}`, { method: 'DELETE' });
  },

  async getVersions(id: string): Promise<any[]> {
    const data = await apiFetch(`/api/documents/${id}/versions`);
    return data.versions || [];
  },

  async createVersion(id: string): Promise<any> {
    const data = await apiFetch(`/api/documents/${id}/versions`, { method: 'POST' });
    return data.version;
  },
};
