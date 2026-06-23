import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export const checkHealth = async () => {
  const response = await apiClient.get('/health');
  return response.data;
};

export const searchKnowledge = async (query: string, topK: number = 5) => {
  const response = await apiClient.post('/knowledge/search', { query, top_k: topK });
  return response.data;
};

export const addKnowledge = async (text: string, metadata: object) => {
  const response = await apiClient.post('/knowledge/add', { text, metadata });
  return response.data;
};

export const getPlanList = async () => {
  const response = await apiClient.get('/plan/list');
  return response.data;
};

export const getPlanDetail = async (planId: number) => {
  const response = await apiClient.get(`/plan/${planId}`);
  return response.data;
};

export const deletePlan = async (planId: number) => {
  const response = await apiClient.delete(`/plan/${planId}`);
  return response.data;
};

export const searchDocs = async (query: string) => {
  const response = await apiClient.post('/knowledge/search-docs', { query });
  return response.data;
};

export const rerankKnowledge = async (query: string, documents: { id: string; content: string }[]) => {
  const response = await apiClient.post('/knowledge/rerank', { query, documents });
  return response.data;
};

export const uploadKnowledgeFile = async (file: File, title?: string) => {
  const form = new FormData();
  form.append('file', file);
  if (title) form.append('title', title);
  const response = await apiClient.post('/knowledge/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const getDocuments = async () => {
  const response = await apiClient.get('/knowledge/documents');
  return response.data;
};

export const deleteDocumentRecord = async (docId: number) => {
  const response = await apiClient.delete(`/knowledge/documents/${docId}`);
  return response.data;
};

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export const streamChat = (
  messages: Message[],
  model: string,
  onChunk: (text: string) => void,
  conversationId?: string | null,
  forceSearch?: boolean
) => {
  const controller = new AbortController();
  
  const promise = (async () => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (conversationId) headers['X-Conversation-ID'] = conversationId;
      if (forceSearch) headers['X-Force-Search'] = 'true';

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages, model }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const receivedConvId = response.headers.get('X-Conversation-ID');
      if (receivedConvId && !conversationId) {
         // handle the returned conversationId if needed in the frontend
      }

      if (!response.body) {
        throw new Error('No readable stream available');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        console.log("stream done:", done);
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const event = buffer.substring(0, boundary);
          buffer = buffer.substring(boundary + 2);
          
          if (event.startsWith('data: ')) {
            const data = event.substring(6);
            if (data === '[DONE]') {
              return;
            }
            onChunk(data);
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Chat stream aborted');
      } else {
        console.error('Stream chat error:', error);
      }
    }
  })();
  
  // Return the abort function directly to satisfy the exact phrasing, 
  // but we can also attach the promise to it so it's awaitable.
  const abortFn = () => controller.abort();
  abortFn.finished = promise;
  
  return abortFn;
};

export const getConversations = async () => {
  const response = await apiClient.get('/conversations/');
  return response.data;
};

export const getConversation = async (id: number) => {
  const response = await apiClient.get(`/conversations/${id}`);
  return response.data;
};

export const createConversation = async (title: string, model: string = 'deepseek-chat') => {
  const response = await apiClient.post('/conversations/', { title, model });
  return response.data;
};

export const saveMessages = async (conversationId: number, messages: Message[]) => {
  const response = await apiClient.post(`/conversations/${conversationId}/messages`, { messages });
  return response.data;
};

export const batchVerifyKnowledge = async (chunkIds?: string[], limit?: number) => {
  const response = await apiClient.post('/knowledge/verify', {
    chunk_ids: chunkIds || null,
    limit: limit || 10,
  });
  return response.data;
};

export const deleteKnowledgeChunk = async (chunkId: string) => {
  const response = await apiClient.delete(`/knowledge/${chunkId}`);
  return response.data;
};

export const updateKnowledgeChunk = async (chunkId: string, text: string, metadata: object) => {
  const response = await apiClient.put(`/knowledge/${chunkId}`, { text, metadata });
  return response.data;
};

// ---- Model Configs ----
export const getModels = async () => {
  const response = await apiClient.get('/models/');
  return response.data;
};

export const createModel = async (data: {
  name: string;
  model_id: string;
  base_url: string;
  api_key: string;
  is_default?: boolean;
}) => {
  const response = await apiClient.post('/models/', data);
  return response.data;
};

export const updateModel = async (id: number, data: any) => {
  const response = await apiClient.put(`/models/${id}`, data);
  return response.data;
};

export const deleteModel = async (id: number) => {
  const response = await apiClient.delete(`/models/${id}`);
  return response.data;
};

export const testModelConnection = async (data: {
  base_url: string;
  api_key: string;
  model_id: string;
}) => {
  const response = await apiClient.post('/models/test', data);
  return response.data;
};

export const deleteConversation = async (id: number) => {
  const response = await apiClient.delete(`/conversations/${id}`);
  return response.data;
};
