import apiClient from '../api-client';

export interface Version {
  id: string;
  documentId: string;
  versionNumber: number;
  markdown: string;
  createdAt: string;
  createdBy: string;
}

export interface VersionListResponse {
  versions: Version[];
  total: number;
  limit: number;
  offset: number;
}

export const versionsService = {
  async list(documentId: string, limit = 50, offset = 0): Promise<VersionListResponse> {
    const { data } = await apiClient.get(`/api/documents/${documentId}/versions`, {
      params: { limit, offset },
    });
    return {
      versions: data.versions || [],
      total: data.total ?? 0,
      limit: data.limit ?? limit,
      offset: data.offset ?? offset,
    };
  },

  async create(documentId: string): Promise<Version> {
    const { data } = await apiClient.post(`/api/documents/${documentId}/versions`);
    return data.version;
  },

  async restore(documentId: string, markdown: string): Promise<void> {
    await apiClient.patch(`/api/documents/${documentId}`, { markdown });
  },
};
