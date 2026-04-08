import apiClient from '../api-client';

export interface ClaudePromptInput {
  prompt: string;
  documentId?: string;
}

export interface ClaudeArtifact {
  artifactId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  lastEditor: string;
}

export const claudeService = {
  async sendPrompt(input: ClaudePromptInput): Promise<string> {
    const { data } = await apiClient.post('/api/claude/prompt', input);
    return data.response;
  },

  async listArtifacts(): Promise<ClaudeArtifact[]> {
    const { data } = await apiClient.get('/api/claude/artifacts');
    return data.artifacts || [];
  },

  async getArtifact(id: string): Promise<ClaudeArtifact> {
    const { data } = await apiClient.get(`/api/claude/artifacts/${id}`);
    return data.artifact;
  },

  async createArtifact(title: string, content: string): Promise<ClaudeArtifact> {
    const { data } = await apiClient.post('/api/claude/create', { title, content });
    return data.artifact;
  },

  async editArtifact(id: string, instruction: string): Promise<ClaudeArtifact> {
    const { data } = await apiClient.post(`/api/claude/edit/${id}`, { instruction });
    return data.artifact;
  },
};
