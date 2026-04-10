import apiClient from '../api-client';

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

export const documentsService = {
  async list(): Promise<Document[]> {
    const data = await apiClient.get<{ documents: Document[] }>('/api/documents');
    return data.documents || [];
  },

  async get(id: string): Promise<Document> {
    const data = await apiClient.get<{ document: Document }>(`/api/documents/${id}`);
    return data.document;
  },

  async create(input: CreateDocumentInput): Promise<Document> {
    const data = await apiClient.post<{ document: Document }>('/api/documents', input);
    return data.document;
  },

  async update(id: string, input: UpdateDocumentInput): Promise<Document> {
    const data = await apiClient.patch<{ document: Document }>(`/api/documents/${id}`, input);
    return data.document;
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/api/documents/${id}`);
  },

  async getVersions(id: string): Promise<any[]> {
    const data = await apiClient.get<{ versions: any[] }>(`/api/documents/${id}/versions`);
    return data.versions || [];
  },

  async createVersion(id: string): Promise<any> {
    const data = await apiClient.post<{ version: any }>(`/api/documents/${id}/versions`);
    return data.version;
  },
};
