
export enum AuditStatus {
  COMPLIANT = 'COMPLIANT',
  VIOLATION = 'VIOLATION',
  UNCERTAIN = 'UNCERTAIN',
}

export interface AuditReport {
  status: AuditStatus;
  rawMarkdown: string;
  groundingUrls?: Array<{ uri: string; title: string }>;
}

export interface ImageEditRequest {
  image: string; // base64
  prompt: string;
}
